import { Router } from 'express';
import { protect, AuthRequest } from '../middleware/auth.middleware';
import { uploadImage, uploadToCloudinary } from '../lib/cloudinary';
import { slugify } from '../lib/slugify';
import prisma from '../lib/prisma';
import multer from 'multer';

const router = Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'));
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  }
});

// Endpoint: POST /api/media/upload
// Accepts multipart/form-data with 'file' and 'context' fields.
router.post('/upload', protect, upload.single('file'), async (req: AuthRequest, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file provided.' });
        }

        const userId = req.user!.id;
        const { context = 'general' } = req.body; // e.g., "business_logo", "deal_image"

        // Create a unique publicId for Cloudinary to prevent overwrites and organize files
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { name: true }});
        const userSlug = slugify(user?.name || `user-${userId}`);
        const timestamp = Date.now();
        const publicId = `${context}/${userSlug}/${timestamp}`;

        const result = await uploadToCloudinary(req.file.buffer, { publicId, folder: context });

        if (!result || !result.secure_url) {
            return res.status(500).json({ error: 'Cloudinary upload failed.' });
        }
        
        // As a convenience for user_avatar, update the user profile
        if (context === 'user_avatar') {
            await prisma.user.update({
                where: { id: userId },
                data: { avatarUrl: result.secure_url }
            });
        }
        
        res.status(201).json({
            message: 'File uploaded successfully.',
            url: result.secure_url,
            publicId: result.public_id
        });

    } catch (error: any) {
        console.error('File upload error:', error);
        if (error.message && error.message.includes('Only image files are allowed')) {
            return res.status(400).json({ error: error.message });
        }
        res.status(500).json({ error: 'Internal server error during file upload.' });
    }
});

export default router;
