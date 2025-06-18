db = db.getSiblingDB('agroflow');

// Check if admin user already exists
const adminExists = db.users.findOne({ email: 'admin@agroflow.com' });

if (!adminExists) {
    // Create admin user
    db.users.insertOne({
        name: 'Admin',
        email: 'admin@agroflow.com',
        password: '$2a$12$k8Y1E.Vb8xYGkS4lQxvgkuKuqpxq4mlQXQwJgWcMzLyifg7auR3/.',  // hashed password for 'admin123'
        role: 'admin',
        active: true,
        createdAt: new Date(),
        updatedAt: new Date()
    });
    
    print('Admin user created successfully');
} else {
    print('Admin user already exists');
} 