# Profile Picture API Documentation

## Overview

The Profile Picture API allows users to upload, update, and manage their profile pictures using Cloudinary for secure cloud storage and automatic image optimization.

## Base URL
```
/api/profile
```

## Authentication
All endpoints require JWT authentication. Include the token in the Authorization header:
```
Authorization: Bearer <your-jwt-token>
```

## Endpoints

### 1. Get User Profile
**GET** `/api/profile`

Retrieves the current user's profile information including avatar URL.

#### Response
```json
{
  "success": true,
  "user": {
    "id": 1,
    "email": "user@example.com",
    "name": "John Doe",
    "avatarUrl": "https://res.cloudinary.com/your-cloud/image/upload/v1234567890/user-avatars/avatar-1234567890.jpg",
    "points": 150,
    "referralCode": "ABC12345",
    "role": "USER",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

### 2. Update User Profile
**PUT** `/api/profile`

Updates user profile information (name, email).

#### Request Body
```json
{
  "name": "John Doe Updated",
  "email": "newemail@example.com"
}
```

#### Response
```json
{
  "success": true,
  "user": {
    "id": 1,
    "email": "newemail@example.com",
    "name": "John Doe Updated",
    "avatarUrl": "https://res.cloudinary.com/your-cloud/image/upload/v1234567890/user-avatars/avatar-1234567890.jpg",
    "points": 150,
    "referralCode": "ABC12345",
    "role": "USER",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

### 3. Upload Profile Picture
**POST** `/api/profile/avatar`

Uploads a new profile picture. The old avatar (if any) will be automatically deleted from Cloudinary.

#### Request
- **Content-Type**: `multipart/form-data`
- **Field Name**: `avatar`
- **File Types**: JPG, JPEG, PNG, GIF, WebP
- **Max File Size**: 5MB

#### Example using curl
```bash
curl -X POST \
  http://localhost:3000/api/profile/avatar \
  -H "Authorization: Bearer <your-jwt-token>" \
  -F "avatar=@/path/to/your/image.jpg"
```

#### Example using JavaScript (FormData)
```javascript
const formData = new FormData();
formData.append('avatar', fileInput.files[0]);

fetch('/api/profile/avatar', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + token
  },
  body: formData
})
.then(response => response.json())
.then(data => console.log(data));
```

#### Response
```json
{
  "success": true,
  "message": "Profile picture uploaded successfully",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "name": "John Doe",
    "avatarUrl": "https://res.cloudinary.com/your-cloud/image/upload/v1234567890/user-avatars/avatar-1234567890.jpg",
    "points": 150,
    "referralCode": "ABC12345",
    "role": "USER",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

### 4. Remove Profile Picture
**DELETE** `/api/profile/avatar`

Removes the current profile picture from both the database and Cloudinary.

#### Response
```json
{
  "success": true,
  "message": "Profile picture removed successfully",
  "user": {
    "id": 1,
    "email": "user@example.com",
    "name": "John Doe",
    "avatarUrl": null,
    "points": 150,
    "referralCode": "ABC12345",
    "role": "USER",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

## Error Responses

### 400 Bad Request
```json
{
  "error": "No file uploaded"
}
```

```json
{
  "error": "Only image files are allowed!"
}
```

```json
{
  "error": "File size too large. Maximum size is 5MB."
}
```

### 401 Unauthorized
```json
{
  "error": "Authentication required"
}
```

### 404 Not Found
```json
{
  "error": "User not found"
}
```

### 409 Conflict
```json
{
  "error": "Email is already in use"
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal server error"
}
```

## Image Processing Features

### Automatic Optimization
- **Resizing**: Images are automatically resized to 300x300 pixels
- **Cropping**: Face detection for optimal cropping
- **Format**: Automatic format optimization (WebP when supported)
- **Quality**: Automatic quality optimization

### Cloudinary Transformations
```javascript
transformation: [
  { width: 300, height: 300, crop: 'fill', gravity: 'face' },
  { quality: 'auto', fetch_format: 'auto' }
]
```

## Security Features

### File Validation
- Only image files are allowed (MIME type validation)
- File size limit of 5MB
- Single file upload only

### Authentication
- JWT token required for all operations
- Users can only modify their own profile

### Data Protection
- Old avatars are automatically deleted when uploading new ones
- Secure cloud storage with Cloudinary
- No local file storage (temporary files are cleaned up)

## Usage Examples

### Frontend Integration

#### HTML Form
```html
<form id="avatarForm" enctype="multipart/form-data">
  <input type="file" name="avatar" accept="image/*" required>
  <button type="submit">Upload Avatar</button>
</form>
```

#### JavaScript Upload Handler
```javascript
document.getElementById('avatarForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const formData = new FormData(e.target);
  const token = localStorage.getItem('authToken');
  
  try {
    const response = await fetch('/api/profile/avatar', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });
    
    const result = await response.json();
    
    if (result.success) {
      // Update UI with new avatar
      document.getElementById('avatar').src = result.user.avatarUrl;
      alert('Profile picture updated successfully!');
    } else {
      alert('Error: ' + result.error);
    }
  } catch (error) {
    console.error('Upload error:', error);
    alert('Upload failed. Please try again.');
  }
});
```

### React Component Example
```jsx
import React, { useState } from 'react';

const AvatarUpload = ({ user, onUpdate }) => {
  const [uploading, setUploading] = useState(false);

  const handleFileChange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('avatar', file);

    try {
      const response = await fetch('/api/profile/avatar', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('authToken')}`
        },
        body: formData
      });

      const result = await response.json();
      
      if (result.success) {
        onUpdate(result.user);
      } else {
        alert('Error: ' + result.error);
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="avatar-upload">
      <img 
        src={user.avatarUrl || '/default-avatar.png'} 
        alt="Profile" 
        className="avatar"
      />
      <input
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        disabled={uploading}
      />
      {uploading && <p>Uploading...</p>}
    </div>
  );
};
```

## Environment Setup

Make sure to configure the following environment variables:

```bash
CLOUDINARY_CLOUD_NAME="your-cloud-name"
CLOUDINARY_API_KEY="your-api-key"
CLOUDINARY_API_SECRET="your-api-secret"
```

See [Environment Setup Documentation](environment-setup.md) for complete configuration details.
