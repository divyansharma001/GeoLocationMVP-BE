// src/routes/catering.merchant.routes.ts
//
// Merchant-facing catering management routes.
// Mounted at /api in app.ts; all endpoints prefixed with /merchants/me/catering*.

import { Router, Response } from 'express';
import prisma from '../lib/prisma';
import { protect, isApprovedMerchant, AuthRequest } from '../middleware/auth.middleware';
import { Prisma, OrderStatus } from '@prisma/client';

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const parseIntParam = (raw: unknown): number | null => {
  if (raw === undefined || raw === null) return null;
  const str = Array.isArray(raw) ? raw[0] : String(raw);
  const n = parseInt(str, 10);
  return Number.isFinite(n) ? n : null;
};

const sanitizeStringArray = (raw: unknown): string[] => {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((s) => s.trim());
};

interface ChoiceInput {
  id?: number;
  label: string;
  description?: string | null;
  priceModifier?: number;
  isDefault?: boolean;
  isPopular?: boolean;
  displayOrder?: number;
}

interface OptionInput {
  id?: number;
  name: string;
  isRequired?: boolean;
  minSelections?: number;
  maxSelections?: number;
  displayOrder?: number;
  choices?: ChoiceInput[];
}

interface ItemPayload {
  name: string;
  description?: string | null;
  category: string;
  pricingType?: 'PER_PERSON' | 'FIXED';
  pricePerPerson?: number;
  fixedPrice?: number | null;
  minPeople?: number;
  maxPeople?: number | null;
  servesCount?: number | null;
  imageUrl?: string | null;
  imageUrls?: string[];
  tags?: string[];
  packagingType?: string | null;
  dietaryInfo?: string[];
  isActive?: boolean;
  isPopular?: boolean;
  displayOrder?: number;
  specialInstructions?: boolean;
  options?: OptionInput[];
}

const validateItemPayload = (
  body: Partial<ItemPayload>,
  { partial = false }: { partial?: boolean } = {},
): { ok: true; data: any } | { ok: false; error: string } => {
  const out: any = {};

  if (!partial || body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) return { ok: false, error: 'name is required' };
    out.name = body.name.trim().slice(0, 200);
  }

  if (!partial || body.category !== undefined) {
    if (typeof body.category !== 'string' || !body.category.trim()) return { ok: false, error: 'category is required' };
    out.category = body.category.trim().slice(0, 100);
  }

  if (body.description !== undefined) {
    out.description = body.description ? String(body.description).slice(0, 2000) : null;
  }

  if (body.pricingType !== undefined) {
    if (body.pricingType !== 'PER_PERSON' && body.pricingType !== 'FIXED') {
      return { ok: false, error: 'pricingType must be PER_PERSON or FIXED' };
    }
    out.pricingType = body.pricingType;
  }

  if (body.pricePerPerson !== undefined) {
    const n = Number(body.pricePerPerson);
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: 'pricePerPerson must be a non-negative number' };
    out.pricePerPerson = n;
  }

  if (body.fixedPrice !== undefined) {
    if (body.fixedPrice === null) {
      out.fixedPrice = null;
    } else {
      const n = Number(body.fixedPrice);
      if (!Number.isFinite(n) || n < 0) return { ok: false, error: 'fixedPrice must be a non-negative number or null' };
      out.fixedPrice = n;
    }
  }

  if (body.minPeople !== undefined) {
    const n = parseInt(String(body.minPeople), 10);
    if (!Number.isFinite(n) || n < 1) return { ok: false, error: 'minPeople must be an integer >= 1' };
    out.minPeople = n;
  }

  if (body.maxPeople !== undefined) {
    if (body.maxPeople === null) {
      out.maxPeople = null;
    } else {
      const n = parseInt(String(body.maxPeople), 10);
      if (!Number.isFinite(n) || n < 1) return { ok: false, error: 'maxPeople must be an integer >= 1 or null' };
      out.maxPeople = n;
    }
  }

  if (out.minPeople !== undefined && out.maxPeople !== undefined && out.maxPeople !== null && out.maxPeople < out.minPeople) {
    return { ok: false, error: 'maxPeople must be >= minPeople' };
  }

  if (body.servesCount !== undefined) {
    if (body.servesCount === null) {
      out.servesCount = null;
    } else {
      const n = parseInt(String(body.servesCount), 10);
      if (!Number.isFinite(n) || n < 1) return { ok: false, error: 'servesCount must be an integer >= 1 or null' };
      out.servesCount = n;
    }
  }

  if (body.imageUrl !== undefined) out.imageUrl = body.imageUrl ? String(body.imageUrl).slice(0, 1000) : null;
  if (body.imageUrls !== undefined) out.imageUrls = sanitizeStringArray(body.imageUrls);
  if (body.tags !== undefined) out.tags = sanitizeStringArray(body.tags);
  if (body.packagingType !== undefined) out.packagingType = body.packagingType ? String(body.packagingType).slice(0, 100) : null;
  if (body.dietaryInfo !== undefined) out.dietaryInfo = sanitizeStringArray(body.dietaryInfo);
  if (typeof body.isActive === 'boolean') out.isActive = body.isActive;
  if (typeof body.isPopular === 'boolean') out.isPopular = body.isPopular;
  if (body.displayOrder !== undefined) {
    const n = parseInt(String(body.displayOrder), 10);
    if (Number.isFinite(n)) out.displayOrder = n;
  }
  if (typeof body.specialInstructions === 'boolean') out.specialInstructions = body.specialInstructions;

  return { ok: true, data: out };
};

const validateOptionInput = (raw: any): { ok: true; data: any } | { ok: false; error: string } => {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'option must be an object' };
  if (typeof raw.name !== 'string' || !raw.name.trim()) return { ok: false, error: 'option.name is required' };

  const minSel = raw.minSelections !== undefined ? parseInt(String(raw.minSelections), 10) : 0;
  const maxSel = raw.maxSelections !== undefined ? parseInt(String(raw.maxSelections), 10) : 1;
  if (!Number.isFinite(minSel) || minSel < 0) return { ok: false, error: 'option.minSelections must be >= 0' };
  if (!Number.isFinite(maxSel) || maxSel < 1) return { ok: false, error: 'option.maxSelections must be >= 1' };
  if (maxSel < minSel) return { ok: false, error: 'option.maxSelections must be >= minSelections' };

  const choices = Array.isArray(raw.choices) ? raw.choices : [];
  const cleanChoices: any[] = [];
  for (const c of choices) {
    if (!c || typeof c !== 'object') continue;
    if (typeof c.label !== 'string' || !c.label.trim()) return { ok: false, error: 'choice.label is required' };
    const priceModifier = c.priceModifier !== undefined ? Number(c.priceModifier) : 0;
    if (!Number.isFinite(priceModifier)) return { ok: false, error: 'choice.priceModifier must be a number' };
    cleanChoices.push({
      label: c.label.trim().slice(0, 200),
      description: c.description ? String(c.description).slice(0, 500) : null,
      priceModifier,
      isDefault: !!c.isDefault,
      isPopular: !!c.isPopular,
      displayOrder: Number.isFinite(parseInt(String(c.displayOrder), 10)) ? parseInt(String(c.displayOrder), 10) : 0,
    });
  }

  return {
    ok: true,
    data: {
      name: raw.name.trim().slice(0, 200),
      isRequired: !!raw.isRequired,
      minSelections: minSel,
      maxSelections: maxSel,
      displayOrder: Number.isFinite(parseInt(String(raw.displayOrder), 10)) ? parseInt(String(raw.displayOrder), 10) : 0,
      choices: cleanChoices,
    },
  };
};

async function loadOwnedItem(req: AuthRequest, res: Response, itemId: number) {
  const merchantId = req.merchant?.id;
  if (!merchantId) {
    res.status(401).json({ error: 'Merchant authentication required' });
    return null;
  }
  const item = await prisma.cateringItem.findFirst({ where: { id: itemId, merchantId } });
  if (!item) {
    res.status(404).json({ error: 'Catering item not found' });
    return null;
  }
  return item;
}

const itemInclude = {
  options: {
    orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }] as any,
    include: {
      choices: { orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }] as any },
    },
  },
};

// ─── List ─────────────────────────────────────────────────────────────────────

router.get('/merchants/me/catering-items', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const includeInactive = req.query.includeInactive === 'true';
    const where: Prisma.CateringItemWhereInput = { merchantId };
    if (!includeInactive) where.isActive = true;

    const items = await prisma.cateringItem.findMany({
      where,
      include: itemInclude,
      orderBy: [{ category: 'asc' }, { displayOrder: 'asc' }, { id: 'asc' }],
    });

    res.status(200).json({ total: items.length, items });
  } catch (err) {
    console.error('[Catering] list failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Categories (distinct list for the merchant) ──────────────────────────────

router.get('/merchants/me/catering-categories', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const rows = await prisma.cateringItem.findMany({
      where: { merchantId },
      select: { category: true },
      distinct: ['category'],
      orderBy: { category: 'asc' },
    });
    res.status(200).json({ categories: rows.map((r) => r.category) });
  } catch (err) {
    console.error('[Catering] categories failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Get one ──────────────────────────────────────────────────────────────────

router.get('/merchants/me/catering-items/:id', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const id = parseIntParam(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid id' });

    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const item = await prisma.cateringItem.findFirst({
      where: { id, merchantId },
      include: itemInclude,
    });
    if (!item) return res.status(404).json({ error: 'Catering item not found' });

    res.status(200).json({ item });
  } catch (err) {
    console.error('[Catering] get failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Create ───────────────────────────────────────────────────────────────────

router.post(
  '/merchants/me/catering-items',
  protect,
  isApprovedMerchant,
  async (req: AuthRequest, res) => {
    try {
      const merchantId = req.merchant?.id;
      if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

      const validated = validateItemPayload(req.body || {});
      if (!validated.ok) return res.status(400).json({ error: validated.error });

      const optionsRaw: any[] = Array.isArray(req.body?.options) ? req.body.options : [];
      const cleanOptions: any[] = [];
      for (const opt of optionsRaw) {
        const v = validateOptionInput(opt);
        if (!v.ok) return res.status(400).json({ error: v.error });
        cleanOptions.push(v.data);
      }

      const item = await prisma.cateringItem.create({
        data: {
          merchantId,
          ...validated.data,
          options: cleanOptions.length
            ? {
                create: cleanOptions.map((opt) => ({
                  name: opt.name,
                  isRequired: opt.isRequired,
                  minSelections: opt.minSelections,
                  maxSelections: opt.maxSelections,
                  displayOrder: opt.displayOrder,
                  choices: opt.choices.length
                    ? { create: opt.choices }
                    : undefined,
                })),
              }
            : undefined,
        },
        include: itemInclude,
      });

      res.status(201).json({ item });
    } catch (err) {
      console.error('[Catering] create failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ─── Update (item fields + replace-all options) ───────────────────────────────
//
// PUT replaces options if `options` is present in the body. Omit the field to
// keep them intact. This avoids partial-merge complexity for v1.

router.put(
  '/merchants/me/catering-items/:id',
  protect,
  isApprovedMerchant,
  async (req: AuthRequest, res) => {
    try {
      const id = parseIntParam(req.params.id);
      if (id === null) return res.status(400).json({ error: 'Invalid id' });

      const existing = await loadOwnedItem(req, res, id);
      if (!existing) return;

      const validated = validateItemPayload(req.body || {}, { partial: true });
      if (!validated.ok) return res.status(400).json({ error: validated.error });

      let replaceOptions = false;
      const cleanOptions: any[] = [];
      if (Array.isArray(req.body?.options)) {
        replaceOptions = true;
        for (const opt of req.body.options) {
          const v = validateOptionInput(opt);
          if (!v.ok) return res.status(400).json({ error: v.error });
          cleanOptions.push(v.data);
        }
      }

      const item = await prisma.$transaction(async (tx) => {
        if (replaceOptions) {
          await tx.cateringItemOption.deleteMany({ where: { cateringItemId: id } });
        }
        return tx.cateringItem.update({
          where: { id },
          data: {
            ...validated.data,
            ...(replaceOptions
              ? {
                  options: {
                    create: cleanOptions.map((opt) => ({
                      name: opt.name,
                      isRequired: opt.isRequired,
                      minSelections: opt.minSelections,
                      maxSelections: opt.maxSelections,
                      displayOrder: opt.displayOrder,
                      choices: opt.choices.length ? { create: opt.choices } : undefined,
                    })),
                  },
                }
              : {}),
          },
          include: itemInclude,
        });
      });

      res.status(200).json({ item });
    } catch (err) {
      console.error('[Catering] update failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ─── Soft-delete (sets isActive=false) ────────────────────────────────────────

router.delete('/merchants/me/catering-items/:id', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const id = parseIntParam(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid id' });

    const existing = await loadOwnedItem(req, res, id);
    if (!existing) return;

    const hard = req.query.hard === 'true';
    if (hard) {
      await prisma.cateringItem.delete({ where: { id } });
      return res.status(200).json({ message: 'Catering item permanently removed' });
    }
    await prisma.cateringItem.update({ where: { id }, data: { isActive: false } });
    res.status(200).json({ message: 'Catering item archived' });
  } catch (err) {
    console.error('[Catering] delete failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Option group sub-routes ──────────────────────────────────────────────────

router.post(
  '/merchants/me/catering-items/:id/options',
  protect,
  isApprovedMerchant,
  async (req: AuthRequest, res) => {
    try {
      const id = parseIntParam(req.params.id);
      if (id === null) return res.status(400).json({ error: 'Invalid id' });

      const item = await loadOwnedItem(req, res, id);
      if (!item) return;

      const v = validateOptionInput(req.body || {});
      if (!v.ok) return res.status(400).json({ error: v.error });

      const option = await prisma.cateringItemOption.create({
        data: {
          cateringItemId: id,
          name: v.data.name,
          isRequired: v.data.isRequired,
          minSelections: v.data.minSelections,
          maxSelections: v.data.maxSelections,
          displayOrder: v.data.displayOrder,
          choices: v.data.choices.length ? { create: v.data.choices } : undefined,
        },
        include: { choices: { orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }] } },
      });

      res.status(201).json({ option });
    } catch (err) {
      console.error('[Catering] add option failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.put(
  '/merchants/me/catering-items/:itemId/options/:optionId',
  protect,
  isApprovedMerchant,
  async (req: AuthRequest, res) => {
    try {
      const itemId = parseIntParam(req.params.itemId);
      const optionId = parseIntParam(req.params.optionId);
      if (itemId === null || optionId === null) return res.status(400).json({ error: 'Invalid id' });

      const item = await loadOwnedItem(req, res, itemId);
      if (!item) return;

      const existing = await prisma.cateringItemOption.findFirst({ where: { id: optionId, cateringItemId: itemId } });
      if (!existing) return res.status(404).json({ error: 'Option not found' });

      const v = validateOptionInput(req.body || {});
      if (!v.ok) return res.status(400).json({ error: v.error });

      const option = await prisma.$transaction(async (tx) => {
        await tx.cateringItemOptionChoice.deleteMany({ where: { optionId } });
        return tx.cateringItemOption.update({
          where: { id: optionId },
          data: {
            name: v.data.name,
            isRequired: v.data.isRequired,
            minSelections: v.data.minSelections,
            maxSelections: v.data.maxSelections,
            displayOrder: v.data.displayOrder,
            choices: v.data.choices.length ? { create: v.data.choices } : undefined,
          },
          include: { choices: { orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }] } },
        });
      });

      res.status(200).json({ option });
    } catch (err) {
      console.error('[Catering] update option failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

router.delete(
  '/merchants/me/catering-items/:itemId/options/:optionId',
  protect,
  isApprovedMerchant,
  async (req: AuthRequest, res) => {
    try {
      const itemId = parseIntParam(req.params.itemId);
      const optionId = parseIntParam(req.params.optionId);
      if (itemId === null || optionId === null) return res.status(400).json({ error: 'Invalid id' });

      const item = await loadOwnedItem(req, res, itemId);
      if (!item) return;

      const existing = await prisma.cateringItemOption.findFirst({ where: { id: optionId, cateringItemId: itemId } });
      if (!existing) return res.status(404).json({ error: 'Option not found' });

      await prisma.cateringItemOption.delete({ where: { id: optionId } });
      res.status(200).json({ message: 'Option removed' });
    } catch (err) {
      console.error('[Catering] delete option failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

// ─── Orders inbox ────────────────────────────────────────────────────────────
//
// Catering orders live in the shared Order table; they're identified by
// metadata.kind === 'CATERING'. Merchants only see orders for their own
// merchantId. Status transitions are gated to a clear lifecycle.

const CATERING_STATUSES: OrderStatus[] = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'];

const ALLOWED_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  REFUNDED: [],
};

const orderIncludeForMerchant = {
  user: { select: { id: true, name: true, email: true, avatarUrl: true } },
  cateringOrderItems: {
    include: {
      cateringItem: { select: { id: true, name: true, imageUrl: true, category: true } },
    },
  },
};

router.get('/merchants/me/catering-orders', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '20'), 10) || 20));
    const skip = (page - 1) * limit;

    const where: Prisma.OrderWhereInput = {
      merchantId,
      metadata: { path: ['kind'], equals: 'CATERING' },
    };

    const statusFilter = req.query.status;
    if (typeof statusFilter === 'string' && statusFilter.length > 0 && statusFilter !== 'ALL') {
      if (!CATERING_STATUSES.includes(statusFilter as OrderStatus)) {
        return res.status(400).json({ error: 'Invalid status filter' });
      }
      where.status = statusFilter as OrderStatus;
    }

    const [total, orders, statusCounts] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        include: orderIncludeForMerchant,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      // Per-status counts (across all catering orders, ignoring the status filter)
      // so the FE can show counts on each tab without an extra round-trip.
      prisma.order.groupBy({
        by: ['status'],
        where: {
          merchantId,
          metadata: { path: ['kind'], equals: 'CATERING' },
        },
        _count: { _all: true },
      }),
    ]);

    const counts: Record<string, number> = { ALL: 0 };
    for (const s of CATERING_STATUSES) counts[s] = 0;
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
    console.error('[Catering orders] list failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/merchants/me/catering-orders/:orderId', protect, isApprovedMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });
    const orderId = parseIntParam(req.params.orderId);
    if (orderId === null) return res.status(400).json({ error: 'Invalid orderId' });

    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        merchantId,
        metadata: { path: ['kind'], equals: 'CATERING' },
      },
      include: orderIncludeForMerchant,
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    res.status(200).json({ order });
  } catch (err) {
    console.error('[Catering orders] get failed', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put(
  '/merchants/me/catering-orders/:orderId/status',
  protect,
  isApprovedMerchant,
  async (req: AuthRequest, res) => {
    try {
      const merchantId = req.merchant?.id;
      if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });
      const orderId = parseIntParam(req.params.orderId);
      if (orderId === null) return res.status(400).json({ error: 'Invalid orderId' });

      const target = req.body?.status as OrderStatus | undefined;
      if (!target || !CATERING_STATUSES.includes(target)) {
        return res.status(400).json({ error: 'Invalid target status' });
      }
      const merchantNote = typeof req.body?.merchantNote === 'string' ? req.body.merchantNote.slice(0, 500) : null;

      const existing = await prisma.order.findFirst({
        where: {
          id: orderId,
          merchantId,
          metadata: { path: ['kind'], equals: 'CATERING' },
        },
      });
      if (!existing) return res.status(404).json({ error: 'Order not found' });

      const allowed = ALLOWED_TRANSITIONS[existing.status] ?? [];
      if (!allowed.includes(target)) {
        return res.status(400).json({
          error: `Cannot transition from ${existing.status} to ${target}`,
          allowedTransitions: allowed,
        });
      }

      // Merge merchantNote into metadata without losing existing fields.
      const existingMeta = (existing.metadata ?? {}) as Record<string, any>;
      const merchantNotes: Array<{ at: string; status: OrderStatus; note: string | null }> = Array.isArray(existingMeta.merchantNotes)
        ? existingMeta.merchantNotes
        : [];
      if (merchantNote || target !== existing.status) {
        merchantNotes.push({ at: new Date().toISOString(), status: target, note: merchantNote });
      }
      const nextMetadata: Prisma.InputJsonValue = {
        ...existingMeta,
        merchantNotes,
      };

      const updateData: Prisma.OrderUpdateInput = {
        status: target,
        metadata: nextMetadata,
      };
      if (target === 'COMPLETED') updateData.completedAt = new Date();
      if (target === 'CANCELLED') updateData.cancelledAt = new Date();

      const updated = await prisma.order.update({
        where: { id: orderId },
        data: updateData,
        include: orderIncludeForMerchant,
      });

      res.status(200).json({ order: updated });
    } catch (err) {
      console.error('[Catering orders] status update failed', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  },
);

export default router;
