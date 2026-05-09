// src/routes/catering.public.routes.ts
//
// Public catering routes for consumers. Mounted at /api/catering in app.ts.
// Browse endpoints are unauthenticated. Order endpoints require user auth
// because we need a userId to attach the Order to.

import { Router } from 'express';
import prisma from '../lib/prisma';
import { protect, AuthRequest } from '../middleware/auth.middleware';
import { Prisma } from '@prisma/client';

const router = Router();

const parseMerchantId = (raw: unknown): number | null => {
  if (raw === undefined || raw === null) return null;
  const str = Array.isArray(raw) ? raw[0] : String(raw);
  const n = parseInt(str, 10);
  return Number.isFinite(n) ? n : null;
};

const itemInclude = {
  options: {
    orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }] as any,
    include: {
      choices: { orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }] as any },
    },
  },
};

// ─── GET /api/catering/:merchantId ────────────────────────────────────────────
// Returns active items for the merchant grouped by displayOrder/category, plus
// merchant header info (businessName, logoUrl, description) so the consumer
// page can render without an extra round-trip.
router.get('/:merchantId', async (req, res) => {
  try {
    const merchantId = parseMerchantId(req.params.merchantId);
    if (merchantId === null) return res.status(400).json({ error: 'Invalid merchantId' });

    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      select: {
        id: true,
        businessName: true,
        logoUrl: true,
        description: true,
        status: true,
        priceRange: true,
        city: true,
        latitude: true,
        longitude: true,
      },
    });
    if (!merchant || merchant.status !== 'APPROVED') {
      return res.status(404).json({ error: 'Catering not available' });
    }

    const items = await prisma.cateringItem.findMany({
      where: { merchantId, isActive: true },
      include: itemInclude,
      orderBy: [{ category: 'asc' }, { displayOrder: 'asc' }, { id: 'asc' }],
    });

    res.status(200).json({
      merchant: {
        id: merchant.id,
        businessName: merchant.businessName,
        logoUrl: merchant.logoUrl,
        description: merchant.description,
        priceRange: merchant.priceRange,
        city: merchant.city,
        latitude: merchant.latitude,
        longitude: merchant.longitude,
      },
      items,
      total: items.length,
    });
  } catch (err) {
    console.error('[Catering public] list failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/catering/:merchantId/categories ─────────────────────────────────
// Returns the distinct category list for active items only.
router.get('/:merchantId/categories', async (req, res) => {
  try {
    const merchantId = parseMerchantId(req.params.merchantId);
    if (merchantId === null) return res.status(400).json({ error: 'Invalid merchantId' });

    const rows = await prisma.cateringItem.findMany({
      where: { merchantId, isActive: true },
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    });
    res.status(200).json({ categories: rows.map((r) => r.category) });
  } catch (err) {
    console.error('[Catering public] categories failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Order creation ───────────────────────────────────────────────────────────
//
// Orders carry catering line-items. Server recomputes all prices from the
// canonical CateringItem + chosen options — never trust client-supplied totals.
// Status starts as PENDING; the merchant follows up to confirm/charge.

const FULFILLMENT_TYPES = new Set(['PICKUP', 'DELIVERY']);

interface CartItemInput {
  cateringItemId: number;
  quantity: number;
  selectedChoiceIds: number[];
  specialInstructions?: string | null;
}

interface OrderPayload {
  customerName: string;
  contactEmail: string;
  contactPhone: string;
  fulfillmentType: 'PICKUP' | 'DELIVERY';
  deliveryAddress?: string | null;
  eventDate?: string | null;
  notes?: string | null;
  items: CartItemInput[];
}

const generateOrderNumber = () => {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `CTR-${ts}-${rand}`;
};

router.post('/:merchantId/orders', protect, async (req: AuthRequest, res) => {
  try {
    const merchantId = parseMerchantId(req.params.merchantId);
    if (merchantId === null) return res.status(400).json({ error: 'Invalid merchantId' });

    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const body = req.body as OrderPayload | undefined;
    if (!body || typeof body !== 'object') return res.status(400).json({ error: 'Invalid payload' });

    if (typeof body.customerName !== 'string' || !body.customerName.trim()) {
      return res.status(400).json({ error: 'customerName is required' });
    }
    if (typeof body.contactEmail !== 'string' || !body.contactEmail.trim()) {
      return res.status(400).json({ error: 'contactEmail is required' });
    }
    if (typeof body.contactPhone !== 'string' || !body.contactPhone.trim()) {
      return res.status(400).json({ error: 'contactPhone is required' });
    }
    if (!FULFILLMENT_TYPES.has(body.fulfillmentType)) {
      return res.status(400).json({ error: 'fulfillmentType must be PICKUP or DELIVERY' });
    }
    if (body.fulfillmentType === 'DELIVERY' && (typeof body.deliveryAddress !== 'string' || !body.deliveryAddress.trim())) {
      return res.status(400).json({ error: 'deliveryAddress is required for DELIVERY orders' });
    }
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required' });
    }

    // Verify merchant is approved
    const merchant = await prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true, status: true, businessName: true },
    });
    if (!merchant || merchant.status !== 'APPROVED') {
      return res.status(404).json({ error: 'Merchant not available for catering' });
    }

    // Load all referenced catering items in one query (with options + choices for snapshot).
    const itemIds = Array.from(new Set(body.items.map((i) => Number(i.cateringItemId)).filter((n) => Number.isFinite(n))));
    if (itemIds.length === 0) return res.status(400).json({ error: 'No valid item ids provided' });

    const dbItems = await prisma.cateringItem.findMany({
      where: { id: { in: itemIds }, merchantId, isActive: true },
      include: {
        options: { include: { choices: true } },
      },
    });
    const dbItemById = new Map(dbItems.map((i) => [i.id, i]));

    // Validate + compute server-side line totals.
    type Line = {
      cateringItemId: number;
      quantity: number;
      pricePerUnit: number;
      totalPrice: number;
      specialInstructions: string | null;
      /** Empty array means "no options were selected"; persisted as JSON null. */
      optionSnapshot: Array<{ optionId: number; optionName: string; choices: Array<{ choiceId: number; label: string; priceModifier: number }> }>;
    };
    const lines: Line[] = [];
    let subtotal = 0;

    for (const incoming of body.items) {
      const item = dbItemById.get(Number(incoming.cateringItemId));
      if (!item) {
        return res.status(400).json({ error: `Item ${incoming.cateringItemId} is not available` });
      }
      const qty = parseInt(String(incoming.quantity), 10);
      if (!Number.isFinite(qty) || qty < 1) {
        return res.status(400).json({ error: `Invalid quantity for "${item.name}"` });
      }
      if (qty < item.minPeople) {
        return res.status(400).json({ error: `"${item.name}" requires at least ${item.minPeople}` });
      }
      if (item.maxPeople != null && qty > item.maxPeople) {
        return res.status(400).json({ error: `"${item.name}" allows at most ${item.maxPeople}` });
      }

      const selectedIds = new Set((incoming.selectedChoiceIds ?? []).map((n) => Number(n)).filter((n) => Number.isFinite(n)));
      let optionModifiers = 0;

      // Validate option selections + accumulate price modifiers.
      const snapshot: any[] = [];
      for (const opt of item.options) {
        const chosen = opt.choices.filter((c) => selectedIds.has(c.id));
        if (opt.isRequired && chosen.length < Math.max(1, opt.minSelections)) {
          return res.status(400).json({ error: `"${item.name}" — option "${opt.name}" requires at least ${Math.max(1, opt.minSelections)}` });
        }
        if (chosen.length > opt.maxSelections) {
          return res.status(400).json({ error: `"${item.name}" — option "${opt.name}" allows at most ${opt.maxSelections}` });
        }
        for (const c of chosen) optionModifiers += c.priceModifier;
        if (chosen.length > 0) {
          snapshot.push({
            optionId: opt.id,
            optionName: opt.name,
            choices: chosen.map((c) => ({ choiceId: c.id, label: c.label, priceModifier: c.priceModifier })),
          });
        }
      }

      let pricePerUnit: number;
      let totalPrice: number;
      if (item.pricingType === 'FIXED' && item.fixedPrice != null) {
        pricePerUnit = item.fixedPrice + optionModifiers;
        totalPrice = pricePerUnit; // fixed = one-shot price; quantity tracked but not multiplied
      } else {
        pricePerUnit = item.pricePerPerson + optionModifiers;
        totalPrice = pricePerUnit * qty;
      }
      subtotal += totalPrice;

      lines.push({
        cateringItemId: item.id,
        quantity: qty,
        pricePerUnit,
        totalPrice,
        specialInstructions: incoming.specialInstructions ? String(incoming.specialInstructions).slice(0, 500) : null,
        optionSnapshot: snapshot,
      });
    }

    // Round to cents to avoid float drift.
    const roundCents = (n: number) => Math.round(n * 100) / 100;
    subtotal = roundCents(subtotal);
    const finalAmount = subtotal;

    // Persist Order + CateringOrderItem rows in one transaction.
    const orderNumber = generateOrderNumber();
    const orderMetadata: Prisma.InputJsonValue = {
      kind: 'CATERING',
      customerName: body.customerName.trim(),
      contactEmail: body.contactEmail.trim(),
      contactPhone: body.contactPhone.trim(),
      fulfillmentType: body.fulfillmentType,
      deliveryAddress: body.fulfillmentType === 'DELIVERY' ? body.deliveryAddress!.trim() : null,
      eventDate: body.eventDate ? body.eventDate : null,
      notes: body.notes ? String(body.notes).slice(0, 1000) : null,
    };

    const created = await prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          userId,
          merchantId,
          orderNumber,
          subtotal,
          finalAmount,
          status: 'PENDING',
          // Existing Order.orderItems is a Json field used by other flows; keep
          // a compact summary here too so legacy consumers can read it.
          orderItems: lines.map((l) => ({
            cateringItemId: l.cateringItemId,
            quantity: l.quantity,
            totalPrice: l.totalPrice,
          })) as Prisma.InputJsonValue,
          metadata: orderMetadata,
        },
      });

      const cateringItems = await Promise.all(
        lines.map((l) =>
          tx.cateringOrderItem.create({
            data: {
              orderId: order.id,
              cateringItemId: l.cateringItemId,
              quantity: l.quantity,
              pricePerUnit: l.pricePerUnit,
              totalPrice: l.totalPrice,
              specialInstructions: l.specialInstructions,
              selectedOptions: l.optionSnapshot.length
                ? (l.optionSnapshot as unknown as Prisma.InputJsonValue)
                : Prisma.JsonNull,
            },
            include: { cateringItem: { select: { id: true, name: true, imageUrl: true, category: true } } },
          }),
        ),
      );

      return { order, cateringItems };
    });

    res.status(201).json({
      order: {
        ...created.order,
        cateringOrderItems: created.cateringItems,
        merchant: { id: merchant.id, businessName: merchant.businessName },
      },
    });
  } catch (err) {
    console.error('[Catering public] order create failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/catering/my-orders ─────────────────────────────────────────────
// Paginated list of catering orders placed by the authenticated user.
const CATERING_STATUSES_PUBLIC = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'] as const;
type CateringStatus = (typeof CATERING_STATUSES_PUBLIC)[number];

router.get('/my-orders', protect, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.OrderWhereInput = {
      userId,
      metadata: { path: ['kind'], equals: 'CATERING' },
    };

    const statusFilter = req.query.status;
    if (typeof statusFilter === 'string' && statusFilter.length > 0 && statusFilter !== 'ALL') {
      if (!CATERING_STATUSES_PUBLIC.includes(statusFilter as CateringStatus)) {
        return res.status(400).json({ error: 'Invalid status filter' });
      }
      where.status = statusFilter as CateringStatus;
    }

    const [total, orders, statusCounts] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        include: {
          merchant: { select: { id: true, businessName: true, logoUrl: true } },
          cateringOrderItems: {
            include: {
              cateringItem: { select: { id: true, name: true, imageUrl: true, category: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.order.groupBy({
        by: ['status'],
        where: {
          userId,
          metadata: { path: ['kind'], equals: 'CATERING' },
        },
        _count: { _all: true },
      }),
    ]);

    const counts: Record<string, number> = { ALL: 0 };
    for (const s of CATERING_STATUSES_PUBLIC) counts[s] = 0;
    for (const row of statusCounts) {
      counts[row.status] = row._count._all;
      counts.ALL += row._count._all;
    }

    res.status(200).json({
      orders,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      statusCounts: counts,
    });
  } catch (err) {
    console.error('[Catering public] my-orders failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /api/catering/orders/:orderId ────────────────────────────────────────
// Owner-only access (the user who placed the order).
router.get('/orders/:orderId', protect, async (req: AuthRequest, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Authentication required' });

    const orderId = parseMerchantId(req.params.orderId);
    if (orderId === null) return res.status(400).json({ error: 'Invalid orderId' });

    const order = await prisma.order.findFirst({
      where: { id: orderId, userId },
      include: {
        merchant: { select: { id: true, businessName: true, logoUrl: true } },
        cateringOrderItems: {
          include: {
            cateringItem: { select: { id: true, name: true, imageUrl: true, category: true } },
          },
        },
      },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.status(200).json({ order });
  } catch (err) {
    console.error('[Catering public] order get failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
