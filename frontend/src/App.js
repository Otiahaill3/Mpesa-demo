import React, { useState, useEffect } from "react";
import "./App.css";
import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

function App() {
  const [formData, setFormData] = useState({
    phone: "",
    amount: "",
    order_number: "",
    description: ""
  });
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showTransactions, setShowTransactions] = useState(false);
  const [message, setMessage] = useState("");

  // Fetch transactions
  const fetchTransactions = async () => {
    try {
      const response = await axios.get(`${API}/transactions`);
      setTransactions(response.data);
    } catch (error) {
      console.error("Error fetching transactions:", error);
    }
  };

  useEffect(() => {
    fetchTransactions();
  }, []);

  // Handle form input changes
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // Handle payment submission
  const handlePaymentSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const response = await axios.post(`${API}/request-payment`, {
        phone: formData.phone,
        amount: parseInt(formData.amount),
        order_number: formData.order_number,
        description: formData.description
      });

      setMessage("✅ Payment request sent! Check your phone for MPesa prompt.");
      
      // Clear form
      setFormData({
        phone: "",
        amount: "",
        order_number: "",
        description: ""
      });

      // Refresh transactions
      setTimeout(() => {
        fetchTransactions();
      }, 2000);

    } catch (error) {
      const errorMsg = error.response?.data?.detail || "Payment request failed";
      setMessage(`❌ ${errorMsg}`);
    } finally {
      setLoading(false);
    }
  };

  // Download CSV
  const downloadCSV = async () => {
    try {
      const response = await axios.get(`${API}/transactions/download`, {
        responseType: 'blob'
      });
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'successful_transactions.csv');
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      alert("Failed to download transactions");
    }
  };

  // Format timestamp
  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleString();
  };

  // Get status badge color
  const getStatusColor = (status) => {
    switch (status) {
      case 'Success':
        return 'bg-green-100 text-green-800';
      case 'Failed':
        return 'bg-red-100 text-red-800';
      case 'Pending':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">
            PromptPay Kenya
          </h1>
          <p className="text-xl text-gray-600">
            MPesa STK Push Integration Demo
          </p>
        </div>

        {/* Payment Form */}
        <div className="max-w-md mx-auto bg-white rounded-xl shadow-lg p-6 mb-8">
          <h2 className="text-2xl font-semibold text-gray-800 mb-6 text-center">
            Initiate Payment
          </h2>
          
          <form onSubmit={handlePaymentSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Phone Number
              </label>
              <input
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleInputChange}
                placeholder="e.g., 254712345678"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                required
              />
              <p className="text-xs text-gray-500 mt-1">Format: 254XXXXXXXXX</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Amount (KES)
              </label>
              <input
                type="number"
                name="amount"
                value={formData.amount}
                onChange={handleInputChange}
                placeholder="e.g., 100"
                min="1"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Order Number
              </label>
              <input
                type="text"
                name="order_number"
                value={formData.order_number}
                onChange={handleInputChange}
                placeholder="e.g., ORD12345"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Payment Description
              </label>
              <input
                type="text"
                name="description"
                value={formData.description}
                onChange={handleInputChange}
                placeholder="e.g., Payment for services"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-green-600 text-white py-3 px-4 rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium transition-colors"
            >
              {loading ? "Processing..." : "Initiate Payment"}
            </button>
          </form>

          {message && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800">{message}</p>
            </div>
          )}
        </div>

        {/* Transaction Section */}
        <div className="max-w-6xl mx-auto">
          <div className="bg-white rounded-xl shadow-lg p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-semibold text-gray-800">
                Transaction History
              </h2>
              <div className="space-x-4">
                <button
                  onClick={() => setShowTransactions(!showTransactions)}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                >
                  {showTransactions ? "Hide" : "View"} Transactions
                </button>
                <button
                  onClick={downloadCSV}
                  className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
                >
                  Download CSV
                </button>
              </div>
            </div>

            {showTransactions && (
              <div className="overflow-x-auto">
                {transactions.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">
                    No transactions found
                  </p>
                ) : (
                  <table className="w-full table-auto">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">
                          Order Number
                        </th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">
                          Phone Number
                        </th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">
                          Amount
                        </th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">
                          Description
                        </th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">
                          Status
                        </th>
                        <th className="px-4 py-3 text-left text-sm font-medium text-gray-700">
                          Timestamp
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {transactions.map((transaction) => (
                        <tr key={transaction.id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-sm text-gray-900">
                            {transaction.order_number}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            {transaction.phone}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            KES {transaction.amount.toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            {transaction.description}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(transaction.status)}`}>
                              {transaction.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-900">
                            {formatTimestamp(transaction.timestamp)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;