"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const prisma_1 = __importDefault(require("./lib/prisma"));
const dotenv_1 = __importDefault(require("dotenv"));
const cors_1 = __importDefault(require("cors"));
// Import our new auth routes
const auth_routes_1 = __importDefault(require("./routes/auth.routes"));
const merchant_routes_1 = __importDefault(require("./routes/merchant.routes")); // For protected merchant actions
const deals_public_routes_1 = __importDefault(require("./routes/deals.public.routes")); // For public deal fetching
const deals_user_routes_1 = __importDefault(require("./routes/deals.user.routes")); // For user-specific deal actions
dotenv_1.default.config();
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3000;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.get('/', (req, res) => {
    res.send('YOHOP Server (TypeScript & Prisma Edition) is alive!');
});
// Mount routes
app.use('/api/auth', auth_routes_1.default);
app.use('/api', merchant_routes_1.default); // e.g., /api/merchants/register, /api/deals
app.use('/api', deals_public_routes_1.default); // e.g., /api/deals (GET)
app.use('/api/user', deals_user_routes_1.default); // e.g., /api/user/deals/save, /api/user/deals/saved
// You can keep this for testing or remove it later
app.get('/users', async (req, res) => {
    try {
        const users = await prisma_1.default.user.findMany();
        res.json(users);
    }
    catch (error) {
        res.status(500).json({ error: 'Error fetching users' });
    }
});
const server = app.listen(PORT, () => {
    console.log(`[server]: Server is running at http://localhost:${PORT}`);
});
