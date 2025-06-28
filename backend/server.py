from fastapi import FastAPI, APIRouter, HTTPException, Response
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime
import requests
import base64
import json
import csv
import io

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# MPesa Configuration
CONSUMER_KEY = os.environ['CONSUMER_KEY']
CONSUMER_SECRET = os.environ['CONSUMER_SECRET']
BUSINESS_SHORT_CODE = os.environ['BUSINESS_SHORT_CODE']
PASSKEY = os.environ['PASSKEY']
CALLBACK_URL = os.environ['CALLBACK_URL']

# MPesa API URLs
SANDBOX_BASE_URL = "https://sandbox.safaricom.co.ke"
AUTH_URL = f"{SANDBOX_BASE_URL}/oauth/v1/generate?grant_type=client_credentials"
STK_PUSH_URL = f"{SANDBOX_BASE_URL}/mpesa/stkpush/v1/processrequest"

# Pydantic Models
class PaymentRequest(BaseModel):
    phone: str
    amount: int
    order_number: str
    description: str

class Transaction(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    phone: str
    amount: int
    order_number: str
    description: str
    status: str = "Pending"
    checkout_request_id: Optional[str] = None
    merchant_request_id: Optional[str] = None
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class TransactionResponse(BaseModel):
    id: str
    phone: str
    amount: int
    order_number: str
    description: str
    status: str
    timestamp: datetime

# Helper Functions
async def get_mpesa_access_token():
    """Get access token from MPesa API"""
    try:
        credentials = base64.b64encode(f"{CONSUMER_KEY}:{CONSUMER_SECRET}".encode()).decode()
        headers = {
            "Authorization": f"Basic {credentials}",
            "Content-Type": "application/json"
        }
        
        response = requests.get(AUTH_URL, headers=headers)
        if response.status_code == 200:
            return response.json().get("access_token")
        else:
            logger.error(f"Failed to get access token: {response.text}")
            return None
    except Exception as e:
        logger.error(f"Error getting access token: {str(e)}")
        return None

def generate_timestamp():
    """Generate timestamp in the required format"""
    from datetime import datetime
    return datetime.now().strftime('%Y%m%d%H%M%S')

def generate_password(shortcode, passkey, timestamp):
    """Generate password for STK push"""
    password_string = f"{shortcode}{passkey}{timestamp}"
    return base64.b64encode(password_string.encode()).decode()

# API Routes
@api_router.post("/request-payment")
async def request_payment(payment_request: PaymentRequest):
    """Initiate MPesa STK Push payment"""
    try:
        # Get access token
        access_token = await get_mpesa_access_token()
        if not access_token:
            raise HTTPException(status_code=500, detail="Failed to authenticate with MPesa")

        # Generate timestamp and password
        timestamp = generate_timestamp()
        password = generate_password(BUSINESS_SHORT_CODE, PASSKEY, timestamp)

        # Prepare STK Push request
        stk_push_data = {
            "BusinessShortCode": BUSINESS_SHORT_CODE,
            "Password": password,
            "Timestamp": timestamp,
            "TransactionType": "CustomerPayBillOnline",
            "Amount": payment_request.amount,
            "PartyA": payment_request.phone,
            "PartyB": BUSINESS_SHORT_CODE,
            "PhoneNumber": payment_request.phone,
            "CallBackURL": CALLBACK_URL,
            "AccountReference": payment_request.order_number,
            "TransactionDesc": payment_request.description
        }

        headers = {
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json"
        }

        # Send STK Push request
        response = requests.post(STK_PUSH_URL, json=stk_push_data, headers=headers)
        response_data = response.json()

        if response.status_code == 200 and response_data.get("ResponseCode") == "0":
            # Create transaction record
            transaction = Transaction(
                phone=payment_request.phone,
                amount=payment_request.amount,
                order_number=payment_request.order_number,
                description=payment_request.description,
                checkout_request_id=response_data.get("CheckoutRequestID"),
                merchant_request_id=response_data.get("MerchantRequestID")
            )
            
            await db.transactions.insert_one(transaction.dict())
            
            return {
                "success": True,
                "message": "STK Push initiated successfully",
                "checkout_request_id": response_data.get("CheckoutRequestID"),
                "transaction_id": transaction.id
            }
        else:
            error_msg = response_data.get("errorMessage", "STK Push failed")
            raise HTTPException(status_code=400, detail=error_msg)

    except Exception as e:
        logger.error(f"Error in request_payment: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Payment request failed: {str(e)}")

@api_router.post("/mpesa-callback")
async def mpesa_callback(callback_data: dict):
    """Handle MPesa callback"""
    try:
        logger.info(f"Received callback: {json.dumps(callback_data, indent=2)}")
        
        stk_callback = callback_data.get("Body", {}).get("stkCallback", {})
        checkout_request_id = stk_callback.get("CheckoutRequestID")
        result_code = stk_callback.get("ResultCode")
        
        if checkout_request_id:
            # Update transaction status
            status = "Success" if result_code == 0 else "Failed"
            result = await db.transactions.update_one(
                {"checkout_request_id": checkout_request_id},
                {"$set": {"status": status}}
            )
            
            logger.info(f"Updated transaction {checkout_request_id} with status {status}")
        
        return {"ResultCode": 0, "ResultDesc": "Callback processed successfully"}
    
    except Exception as e:
        logger.error(f"Error processing callback: {str(e)}")
        return {"ResultCode": 1, "ResultDesc": "Callback processing failed"}

@api_router.get("/transactions", response_model=List[TransactionResponse])
async def get_transactions():
    """Get all transactions"""
    try:
        transactions = await db.transactions.find().sort("timestamp", -1).to_list(1000)
        return [TransactionResponse(**transaction) for transaction in transactions]
    except Exception as e:
        logger.error(f"Error fetching transactions: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to fetch transactions")

@api_router.get("/transactions/download")
async def download_transactions():
    """Download successful transactions as CSV"""
    try:
        # Get only successful transactions
        transactions = await db.transactions.find({"status": "Success"}).sort("timestamp", -1).to_list(1000)
        
        if not transactions:
            raise HTTPException(status_code=404, detail="No successful transactions found")
        
        # Create CSV content
        output = io.StringIO()
        writer = csv.writer(output)
        
        # Write header
        writer.writerow(["Order Number", "Phone Number", "Amount", "Description", "Status", "Timestamp"])
        
        # Write data
        for transaction in transactions:
            writer.writerow([
                transaction["order_number"],
                transaction["phone"],
                transaction["amount"],
                transaction["description"],
                transaction["status"],
                transaction["timestamp"].strftime("%Y-%m-%d %H:%M:%S")
            ])
        
        # Prepare response
        output.seek(0)
        
        return StreamingResponse(
            io.BytesIO(output.getvalue().encode()),
            media_type="text/csv",
            headers={"Content-Disposition": "attachment; filename=successful_transactions.csv"}
        )
        
    except Exception as e:
        logger.error(f"Error downloading transactions: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to download transactions")

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()