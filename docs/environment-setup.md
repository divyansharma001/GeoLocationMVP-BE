# Environment Setup

## Required Environment Variables

### Database Configuration
```bash
DATABASE_URL="postgresql://username:password@localhost:5432/geolocationmvp"
```

### JWT Authentication
```bash
JWT_SECRET="your-super-secret-jwt-key-here"
```

### Server Configuration
```bash
PORT=3000
NODE_ENV=development
```

### Email Configuration (Nodemailer)
```bash
EMAIL_HOST="smtp.gmail.com"
EMAIL_PORT=587
EMAIL_USER="your-email@gmail.com"
EMAIL_PASS="your-app-password"
```

### Cloudinary Configuration (Required for Profile Pictures)
```bash
CLOUDINARY_CLOUD_NAME="your-cloud-name"
CLOUDINARY_API_KEY="your-api-key"
CLOUDINARY_API_SECRET="your-api-secret"
```

### Optional Configuration
```bash
DISABLE_SCHEDULER=false
```

## Setting up Cloudinary

1. **Create a Cloudinary Account**
   - Go to [cloudinary.com](https://cloudinary.com)
   - Sign up for a free account

2. **Get Your Credentials**
   - In your Cloudinary dashboard, go to "Settings" → "Security"
   - Copy your Cloud Name, API Key, and API Secret

3. **Add to Environment Variables**
   - Add the three Cloudinary variables to your `.env` file
   - Make sure to keep these credentials secure

## Profile Picture Features

With Cloudinary integration, users can:
- Upload profile pictures (JPG, PNG, GIF, WebP)
- Automatic image optimization and resizing
- Secure cloud storage
- Easy deletion of old avatars when updating

### File Upload Limits
- Maximum file size: 5MB
- Supported formats: JPG, JPEG, PNG, GIF, WebP
- Automatic resizing to 300x300 pixels
- Face detection for optimal cropping
