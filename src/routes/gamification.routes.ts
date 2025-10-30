import express from 'express';
import { protect, AuthRequest } from '../middleware/auth.middleware';
import { getUserGamificationProfile, awardCoins, spendCoins, awardExperience, checkAndAwardAchievements } from '../lib/gamification';
import { createPayPalOrder, capturePayPalPayment, getPayPalOrderDetails, COIN_PACKAGES } from '../lib/paypal';
import prisma from '../lib/prisma';
import { CoinTransactionType, PaymentStatus, AchievementType } from '@prisma/client';

const router = express.Router();

// Get user's gamification profile
router.get('/profile', protect, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const profile = await getUserGamificationProfile(userId);
    
    res.json({
      success: true,
      data: profile,
    });
  } catch (error) {
    console.error('Error fetching gamification profile:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch gamification profile',
    });
  }
});

// Get coin transaction history
router.get('/transactions', protect, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { page = 1, limit = 20 } = req.query;
    
    const skip = (Number(page) - 1) * Number(limit);
    
    const transactions = await prisma.coinTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: Number(limit),
    });
    
    const total = await prisma.coinTransaction.count({
      where: { userId },
    });
    
    res.json({
      success: true,
      data: {
        transactions,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit)),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching coin transactions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch coin transactions',
    });
  }
});

// Get available coin packages
router.get('/coin-packages', (req, res) => {
  res.json({
    success: true,
    data: COIN_PACKAGES,
  });
});

// Create PayPal order for coin purchase
router.post('/purchase/create-order', protect, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { packageIndex } = req.body;
    
    if (packageIndex < 0 || packageIndex >= COIN_PACKAGES.length) {
      return res.status(400).json({
        success: false,
        message: 'Invalid coin package selected',
      });
    }
    
    const coinPackage = COIN_PACKAGES[packageIndex];
    
    // Create PayPal order
    const paypalResult = await createPayPalOrder(coinPackage);
    
    if (!paypalResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to create PayPal order',
        error: paypalResult.error,
      });
    }
    
    // Save payment transaction record
    const paymentTransaction = await prisma.paymentTransaction.create({
      data: {
        userId,
        paypalOrderId: paypalResult.orderId!,
        amount: coinPackage.price,
        coinsPurchased: coinPackage.coins,
        status: PaymentStatus.PENDING,
        paypalResponse: paypalResult.order,
      },
    });
    
    res.json({
      success: true,
      data: {
        orderId: paypalResult.orderId,
        approvalUrl: paypalResult.approvalUrl,
        transactionId: paymentTransaction.id,
        package: coinPackage,
      },
    });
  } catch (error) {
    console.error('Error creating PayPal order:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create payment order',
    });
  }
});

// Capture PayPal payment and award coins
router.post('/purchase/capture', protect, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { orderId } = req.body;
    
    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: 'Order ID is required',
      });
    }
    
    // Find the payment transaction
    const paymentTransaction = await prisma.paymentTransaction.findUnique({
      where: { paypalOrderId: orderId },
    });
    
    if (!paymentTransaction) {
      return res.status(404).json({
        success: false,
        message: 'Payment transaction not found',
      });
    }
    
    if (paymentTransaction.userId !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized access to payment transaction',
      });
    }
    
    if (paymentTransaction.status === PaymentStatus.COMPLETED) {
      return res.status(400).json({
        success: false,
        message: 'Payment already completed',
      });
    }
    
    // Capture PayPal payment
    const captureResult = await capturePayPalPayment(orderId);
    
    if (!captureResult.success) {
      // Handle specific error codes
      let statusCode = 500;
      let message = 'Failed to capture PayPal payment';
      
      if (captureResult.errorCode === 'ORDER_EXPIRED') {
        statusCode = 410; // Gone
        message = 'Payment order has expired. Please create a new payment.';
      } else if (captureResult.errorCode === 'ALREADY_CAPTURED') {
        statusCode = 409; // Conflict
        message = 'Payment has already been processed.';
        
        // Check if coins were already awarded for this payment
        const existingTransaction = await prisma.coinTransaction.findFirst({
          where: { 
            relatedPaymentId: paymentTransaction.id,
            type: CoinTransactionType.PURCHASE 
          }
        });
        
        if (existingTransaction) {
          // Get updated profile and return success since payment was already processed
          const updatedProfile = await getUserGamificationProfile(userId);
          return res.json({
            success: true,
            message: 'Payment was already completed successfully',
            data: {
              coinsAwarded: paymentTransaction.coinsPurchased,
              profile: updatedProfile,
            },
          });
        }
      }
      
      // Update transaction status to failed
      await prisma.paymentTransaction.update({
        where: { id: paymentTransaction.id },
        data: {
          status: PaymentStatus.FAILED,
          failureReason: captureResult.error,
        },
      });
      
      return res.status(statusCode).json({
        success: false,
        message,
        error: captureResult.error,
        errorCode: captureResult.errorCode,
      });
    }
    
    // Update payment transaction and award coins in a single optimized transaction
    let updatedProfile;
    try {
      await prisma.$transaction(async (tx) => {
        // 1. Update payment status
        await tx.paymentTransaction.update({
          where: { id: paymentTransaction.id },
          data: {
            status: PaymentStatus.COMPLETED,
            paypalPaymentId: captureResult.captureId,
            paypalResponse: captureResult.capture,
          },
        });
        
        // 2. Get current user data
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { coins: true, experiencePoints: true, loyaltyTier: true },
        });

        if (!user) {
          throw new Error('User not found');
        }

        // 3. Calculate new balances
        const coinsBalanceBefore = user.coins;
        const coinsBalanceAfter = coinsBalanceBefore + paymentTransaction.coinsPurchased;
        const xpBefore = user.experiencePoints;
        const xpAfter = xpBefore + 30; // XP for purchase

        // 4. Update user coins and XP in one operation
        await tx.user.update({
          where: { id: userId },
          data: { 
            coins: coinsBalanceAfter,
            experiencePoints: xpAfter,
          },
        });

        // 5. Create coin transaction record
        await tx.coinTransaction.create({
          data: {
            userId,
            type: CoinTransactionType.PURCHASE,
            amount: paymentTransaction.coinsPurchased,
            balanceBefore: coinsBalanceBefore,
            balanceAfter: coinsBalanceAfter,
            description: `Purchased ${paymentTransaction.coinsPurchased} coins`,
            metadata: JSON.stringify({
              paypalOrderId: orderId,
              amount: paymentTransaction.amount,
              packageInfo: COIN_PACKAGES.find(p => p.coins === paymentTransaction.coinsPurchased),
            }),
            relatedPaymentId: paymentTransaction.id,
          },
        });
        
        // 6. Check for first purchase achievement (optional, simplified)
        const isFirstPurchase = await tx.paymentTransaction.count({
          where: {
            userId,
            status: PaymentStatus.COMPLETED,
            id: { not: paymentTransaction.id },
          },
        }) === 0;
        
        if (isFirstPurchase) {
          // Simple achievement awarding without complex logic
          const firstPurchaseAchievement = await tx.achievement.findFirst({
            where: { 
              type: AchievementType.FIRST_PURCHASE,
              isActive: true 
            },
          });
          
          if (firstPurchaseAchievement) {
            const existingUserAchievement = await tx.userAchievement.findUnique({
              where: {
                userId_achievementId: {
                  userId,
                  achievementId: firstPurchaseAchievement.id,
                },
              },
            });
            
            if (!existingUserAchievement?.isCompleted) {
              await tx.userAchievement.upsert({
                where: {
                  userId_achievementId: {
                    userId,
                    achievementId: firstPurchaseAchievement.id,
                  },
                },
                update: {
                  isCompleted: true,
                  completedAt: new Date(),
                },
                create: {
                  userId,
                  achievementId: firstPurchaseAchievement.id,
                  isCompleted: true,
                  completedAt: new Date(),
                  progress: {},
                },
              });
            }
          }
        }
      }, {
        timeout: 30000, // 30 seconds timeout for this specific transaction
      });

      // Get updated profile AFTER the transaction completes
      updatedProfile = await getUserGamificationProfile(userId);
      
    } catch (transactionError) {
      console.error('Transaction error:', transactionError);
      throw transactionError;
    }
    
    res.json({
      success: true,
      message: 'Payment completed successfully',
      data: {
        coinsAwarded: paymentTransaction.coinsPurchased,
        profile: updatedProfile,
      },
    });
  } catch (error) {
    console.error('Error capturing PayPal payment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process payment',
    });
  }
});

// Get user achievements
router.get('/achievements', protect, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    
    const achievements = await prisma.achievement.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        UserAchievement: {
          where: { userId },
          select: {
            progress: true,
            isCompleted: true,
            completedAt: true,
          },
        },
      },
    });
    
    const formattedAchievements = achievements.map((achievement: any) => ({
      ...achievement,
      userProgress: achievement.UserAchievement[0] || {
        progress: {},
        isCompleted: false,
        completedAt: null,
      },
      UserAchievement: undefined, // Remove the raw relation data
    }));
    
    res.json({
      success: true,
      data: formattedAchievements,
    });
  } catch (error) {
    console.error('Error fetching achievements:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch achievements',
    });
  }
});

// Get loyalty tier information
router.get('/loyalty-tiers', async (req, res) => {
  try {
    const tiers = await prisma.loyaltyTierConfig.findMany({
      where: { isActive: true },
      orderBy: { minSpent: 'asc' },
    });
    
    res.json({
      success: true,
      data: tiers,
    });
  } catch (error) {
    console.error('Error fetching loyalty tiers:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch loyalty tiers',
    });
  }
});

// Get payment history
router.get('/payments', protect, async (req: AuthRequest, res) => {
  try {
    const userId = req.user!.id;
    const { page = 1, limit = 10 } = req.query;
    
    const skip = (Number(page) - 1) * Number(limit);
    
    const payments = await prisma.paymentTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take: Number(limit),
      select: {
        id: true,
        amount: true,
        coinsPurchased: true,
        status: true,
        createdAt: true,
        paypalOrderId: true,
      },
    });
    
    const total = await prisma.paymentTransaction.count({
      where: { userId },
    });
    
    res.json({
      success: true,
      data: {
        payments,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit)),
        },
      },
    });
  } catch (error) {
    console.error('Error fetching payment history:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment history',
    });
  }
});

// Test endpoint to award coins (development only)
if (process.env.NODE_ENV === 'development') {
  router.post('/dev/award-coins', protect, async (req: AuthRequest, res) => {
    try {
      const userId = req.user!.id;
      const { amount, type = 'EARNED', description = 'Development test' } = req.body;
      
      if (!amount || amount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Valid amount is required',
        });
      }
      
      const result = await awardCoins(userId, amount, type as CoinTransactionType, description);
      
      res.json({
        success: true,
        message: 'Coins awarded successfully',
        data: result,
      });
    } catch (error) {
      console.error('Error awarding coins:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to award coins',
      });
    }
  });
}

export default router;