import { v2 as cloudinary } from 'cloudinary';

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export default cloudinary;

// Helper function to upload image to Cloudinary from file path
export const uploadImage = async (file: Express.Multer.File, folder: string = 'user-avatars'): Promise<string> => {
  try {
    const result = await cloudinary.uploader.upload(file.path, {
      folder,
      resource_type: 'image',
      transformation: [
        { width: 300, height: 300, crop: 'fill', gravity: 'face' },
        { quality: 'auto', fetch_format: 'auto' }
      ],
      overwrite: true,
      invalidate: true
    });
    
    return result.secure_url;
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    throw new Error('Failed to upload image to Cloudinary');
  }
};

// Helper function to upload image to Cloudinary from buffer (for merchant routes)
export const uploadToCloudinary = async (buffer: Buffer, options: { publicId?: string; folder?: string } = {}): Promise<{ secure_url: string; public_id: string }> => {
  try {
    const result = await cloudinary.uploader.upload(
      `data:image/jpeg;base64,${buffer.toString('base64')}`,
      {
        public_id: options.publicId,
        folder: options.folder || 'merchant-images',
        resource_type: 'image',
        transformation: [
          { quality: 'auto', fetch_format: 'auto' }
        ],
        overwrite: true,
        invalidate: true
      }
    );
    
    return {
      secure_url: result.secure_url,
      public_id: result.public_id
    };
  } catch (error) {
    console.error('Cloudinary upload error:', error);
    throw new Error('Failed to upload image to Cloudinary');
  }
};

// Helper function to delete image from Cloudinary
export const deleteImage = async (publicId: string): Promise<void> => {
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (error) {
    console.error('Cloudinary delete error:', error);
    throw new Error('Failed to delete image from Cloudinary');
  }
};

// Helper function to extract public ID from Cloudinary URL
export const extractPublicId = (url: string): string | null => {
  const regex = /\/v\d+\/(.+)\.(jpg|jpeg|png|gif|webp)$/i;
  const match = url.match(regex);
  return match ? match[1] : null;
};