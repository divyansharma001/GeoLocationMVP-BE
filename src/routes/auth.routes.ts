import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { protect, AuthRequest } from '../middleware/auth.middleware';
import { ApiResponse } from '../utils/response.utils';
import { commonValidations, handleValidationErrors } from '../middleware/security.middleware';
import { body } from 'express-validator';

const router = Router();


// --- Endpoint: POST /api/auth/register ---
const registerSchema = z.object({
  email: z.string().email({ message: "Invalid email address" }),
  password: z.string().min(8, { message: "Password must be at least 8 characters long" }),
  name: z.string().optional(),
});

router.post('/register', [
  commonValidations.email,
  commonValidations.password,
  commonValidations.name,
  handleValidationErrors
], async (req: Request, res: Response) => {
  try {
        const { email, password, name } = registerSchema.parse(req.body);
        
        // Normalize email to lowercase to prevent case sensitivity issues
        const normalizedEmail = email.toLowerCase().trim();

    // 2. Check if user already exists
    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
      return ApiResponse.conflict(res, 'Email is already in use');
    }

    // 3. Hash the password
    const hashedPassword = await bcrypt.hash(password, 10); // 10 is the salt rounds

    // 4. Create the new user in the database
    const newUser = await prisma.user.create({
      data: {
        email: normalizedEmail,
        name,
        password: hashedPassword,
      },
    });

    // We don't want to send the password back, even the hashed one
    const { password: _, ...userWithoutPassword } = newUser;

    // 5. Send back a success response
    return ApiResponse.success(res, userWithoutPassword, 'User created successfully', 201);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const validationErrors = error.issues.map(issue => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code
      }));
      return ApiResponse.validationError(res, validationErrors);
    }
    console.error('Registration error:', error);
    return ApiResponse.internalError(res);
  }
});



// Removed duplicate verifyToken - using protect middleware from auth.middleware.ts instead

router.get('/me', protect, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, createdAt: true }, 
    });

    if (!user) {
      return ApiResponse.notFound(res, 'User');
    }

    return ApiResponse.success(res, user);
  } catch (error) {
    console.error('Get me error:', error);
    return ApiResponse.internalError(res);
  }
});




// --- Endpoint: POST /api/auth/login ---
const loginSchema = z.object({
  email: z.string().email({ message: "Invalid email address" }),
  password: z.string(),
});

router.post('/login', [
  commonValidations.email,
  body('password').notEmpty().withMessage('Password is required'),
  handleValidationErrors
], async (req: Request, res: Response) => {
  try {
        const { email, password } = loginSchema.parse(req.body);
        
        // Normalize email to lowercase to prevent case sensitivity issues
        const normalizedEmail = email.toLowerCase().trim();

    // 2. Find the user by email
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user) {
      // Use a generic error message for security
      return ApiResponse.unauthorized(res, 'Invalid credentials');
    }

    // 3. Compare the submitted password with the stored hash
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return ApiResponse.unauthorized(res, 'Invalid credentials');
    }

    // 4. Generate a JWT
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new Error('JWT_SECRET is not defined in the .env file');
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email }, // This is the JWT payload
      jwtSecret,
      { expiresIn: '24h' } // Token will expire in 24 hours
    );

    // 5. Send the token back to the client
    return ApiResponse.success(res, { token }, 'Login successful');
  } catch (error) {
    if (error instanceof z.ZodError) {
      const validationErrors = error.issues.map(issue => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code
      }));
      return ApiResponse.validationError(res, validationErrors);
    }
    console.error('Login error:', error);
    return ApiResponse.internalError(res);
  }
});

export default router;
