import { Router, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import { protect, AuthRequest } from '../middleware/auth.middleware';
import { uploadSingle, handleUploadError, cleanupFile } from '../middleware/upload.middleware';
import { uploadImage, deleteImage, extractPublicId } from '../lib/cloudinary';

const router = Router();

// Validation schema for profile updates
const updateProfileSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be less than 100 characters').optional(),
  email: z.string().email('Invalid email address').optional()
});

// GET /api/profile - Get user profile
router.get('/', protect, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { 
        id: true, 
        email: true, 
        name: true, 
        avatarUrl: true,
        points: true, 
        referralCode: true, 
        role: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).json({ success: true, user });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/profile - Update user profile
router.put('/', protect, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const validatedData = updateProfileSchema.parse(req.body);

    // Check if email is being updated and if it's already in use
    if (validatedData.email) {
      const existingUser = await prisma.user.findFirst({
        where: { 
          email: validatedData.email,
          id: { not: userId }
        }
      });

      if (existingUser) {
        return res.status(409).json({ error: 'Email is already in use' });
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: validatedData,
      select: { 
        id: true, 
        email: true, 
        name: true, 
        avatarUrl: true,
        points: true, 
        referralCode: true, 
        role: true,
        updatedAt: true
      }
    });

    res.status(200).json({ success: true, user: updatedUser });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.issues });
    }
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/profile/avatar - Upload profile picture
router.post('/avatar', protect, uploadSingle, handleUploadError, async (req: AuthRequest, res: Response) => {
  let uploadedFile: Express.Multer.File | undefined;
  
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    uploadedFile = req.file;

    // Get current user to check for existing avatar
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true }
    });

    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Upload image to Cloudinary
    const avatarUrl = await uploadImage(uploadedFile, 'user-avatars');

    // Update user with new avatar URL
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
      select: { 
        id: true, 
        email: true, 
        name: true, 
        avatarUrl: true,
        points: true, 
        referralCode: true, 
        role: true,
        updatedAt: true
      }
    });

    // Delete old avatar from Cloudinary if it exists
    if (currentUser.avatarUrl) {
      const oldPublicId = extractPublicId(currentUser.avatarUrl);
      if (oldPublicId) {
        try {
          await deleteImage(oldPublicId);
        } catch (error) {
          console.error('Error deleting old avatar:', error);
          // Don't fail the request if old avatar deletion fails
        }
      }
    }

    res.status(200).json({ 
      success: true, 
      message: 'Profile picture uploaded successfully',
      user: updatedUser 
    });

  } catch (error) {
    console.error('Upload avatar error:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    // Clean up uploaded file from local storage
    if (uploadedFile) {
      cleanupFile(uploadedFile.path);
    }
  }
});

// DELETE /api/profile/avatar - Remove profile picture
router.delete('/avatar', protect, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    // Get current user to check for existing avatar
    const currentUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { avatarUrl: true }
    });

    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (!currentUser.avatarUrl) {
      return res.status(400).json({ error: 'No profile picture to remove' });
    }

    // Delete avatar from Cloudinary
    const publicId = extractPublicId(currentUser.avatarUrl);
    if (publicId) {
      try {
        await deleteImage(publicId);
      } catch (error) {
        console.error('Error deleting avatar from Cloudinary:', error);
        // Continue with database update even if Cloudinary deletion fails
      }
    }

    // Update user to remove avatar URL
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { avatarUrl: null },
      select: { 
        id: true, 
        email: true, 
        name: true, 
        avatarUrl: true,
        points: true, 
        referralCode: true, 
        role: true,
        updatedAt: true
      }
    });

    res.status(200).json({ 
      success: true, 
      message: 'Profile picture removed successfully',
      user: updatedUser 
    });

  } catch (error) {
    console.error('Remove avatar error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
