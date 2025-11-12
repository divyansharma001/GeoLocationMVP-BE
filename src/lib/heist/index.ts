/**
 * Heist Feature - Main Export
 * 
 * Centralized exports for all heist functionality.
 */

// Configuration
export {
  getHeistConfig,
  validateConfig,
  calculatePointsToSteal,
  hoursToMs,
  type HeistConfig,
} from './config';

// Token Management
export {
  getTokenBalance,
  awardToken,
  spendToken,
  hasTokens,
  getTokenLeaderboard,
  type TokenBalance,
} from './tokens';

// Validation
export {
  checkFeatureEnabled,
  checkSufficientTokens,
  checkAttackerNotOnCooldown,
  checkVictimNotProtected,
  checkNotSelfTargeting,
  checkVictimHasSufficientPoints,
  checkDailyLimit,
  checkHeistEligibility,
  getEligibilityBreakdown,
  type EligibilityResult,
} from './validation';

// Cooldowns
export {
  getLastAttackerHeist,
  getLastVictimHeist,
  checkAttackerCooldown,
  checkVictimProtection,
  getCooldownInfo,
  getHeistsToday,
  hasExceededDailyLimit,
} from './cooldowns';

// Execution
export {
  executeHeist,
  getHeistHistory,
  getHeistStats,
  type HeistResult,
} from './execution';

// Notifications
export {
  createHeistSuccessNotification,
  createHeistVictimNotification,
  createTokenEarnedNotification,
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteOldNotifications,
  type NotificationMetadata,
} from './notifications';

// Items
export {
  getAvailableItems,
  getUserInventory,
  purchaseItem,
  getAttackerItems,
  getVictimItems,
  applyItemEffects,
  recordItemUsage,
  checkItemActive,
  type ActiveItem,
  type ItemEffectResult,
} from './items';
