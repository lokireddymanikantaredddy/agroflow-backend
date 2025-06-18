# AgroFlow Backend

The backend API server for AgroFlow - a comprehensive agricultural business management system.

## API Documentation
- Base URL: https://agroflow-backend-i243.onrender.com
- API Version: v1

## Tech Stack
- Node.js with Express
- MongoDB for database
- JWT for authentication
- Multer for file uploads
- CSV Parser for data processing
- Nodemailer for email notifications

## Features
- **Authentication & Authorization**
  - JWT-based authentication
  - Role-based access control
  - Password encryption
  - Session management

- **Product Management**
  - CRUD operations for products
  - Inventory tracking
  - Stock level monitoring
  - Supplier management

- **Sales & Transactions**
  - Sales processing
  - Invoice generation
  - Payment tracking
  - Credit management

- **Customer Management**
  - Customer profiles
  - Credit tracking
  - Purchase history
  - Payment records

## Getting Started

### Prerequisites
- Node.js (v14 or higher)
- MongoDB
- npm or yarn
- Git

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/lokireddymanikantaredddy/agroflow-backend.git
   cd agroflow-backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   Create a `.env` file in the root directory:
   ```
   # Server Configuration
   PORT=5000
   NODE_ENV=development
   
   # MongoDB Configuration
   MONGODB_URI=your_mongodb_connection_string
   
   # JWT Configuration
   JWT_SECRET=your_jwt_secret_key
   JWT_EXPIRE=24h
   
   # CORS Configuration
   ALLOWED_ORIGINS=http://localhost:5173,https://agroflow.netlify.app
   
   # Email Configuration (optional)
   SMTP_HOST=your_smtp_host
   SMTP_PORT=your_smtp_port
   SMTP_USER=your_smtp_user
   SMTP_PASS=your_smtp_password
   ```

4. Start the development server:
   ```bash
   npm run dev
   ```

## API Endpoints

### Authentication
- POST /api/auth/register - Register new user
- POST /api/auth/login - User login
- GET /api/auth/profile - Get user profile

### Products
- GET /api/products - List all products
- POST /api/products - Create new product
- GET /api/products/:id - Get product details
- PUT /api/products/:id - Update product
- DELETE /api/products/:id - Delete product

### Sales
- GET /api/sales - List all sales
- POST /api/sales - Create new sale
- GET /api/sales/:id - Get sale details
- PUT /api/sales/:id - Update sale
- DELETE /api/sales/:id - Delete sale

### Customers
- GET /api/customers - List all customers
- POST /api/customers - Create new customer
- GET /api/customers/:id - Get customer details
- PUT /api/customers/:id - Update customer
- DELETE /api/customers/:id - Delete customer

## Deployment (Render)

### Automatic Deployment
1. Connect your GitHub repository to Render
2. Configure build settings:
   - Build command: `npm install`
   - Start command: `npm start`
3. Set environment variables in Render dashboard

### Manual Deployment
1. Push changes to the repository:
   ```bash
   git push origin main
   ```
2. Render will automatically deploy from the main branch

## Development Guidelines

### Code Structure
```
src/
├── config/        # Configuration files
├── controllers/   # Request handlers
├── middleware/    # Custom middleware
├── models/        # Database models
├── routes/        # API routes
├── services/      # Business logic
├── utils/         # Utility functions
└── validation/    # Request validation
```

### Best Practices
- Follow RESTful API design principles
- Implement proper error handling
- Use async/await for asynchronous operations
- Validate all incoming requests
- Implement rate limiting
- Use proper logging
- Follow security best practices
- Write clear API documentation

## Error Handling
The API uses standard HTTP status codes and returns errors in the following format:
```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Error description"
  }
}
```

## Contributing
1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License
This project is licensed under the MIT License. 