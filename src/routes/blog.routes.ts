import { Router } from 'express';
import { protect, isMerchant, AuthRequest } from '../middleware/auth.middleware';
import prisma from '../lib/prisma';

const router = Router();

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 200);
}

async function uniqueSlug(merchantId: number, baseSlug: string, excludeId?: number): Promise<string> {
  let slug = baseSlug;
  let counter = 1;
  while (true) {
    // @ts-ignore
    const existing = await prisma.blogPost.findUnique({
      where: { merchantId_slug: { merchantId, slug } },
      select: { id: true },
    });
    if (!existing || (excludeId && existing.id === excludeId)) return slug;
    counter++;
    slug = `${baseSlug}-${counter}`;
  }
}

async function uniqueCategorySlug(merchantId: number, baseSlug: string, excludeId?: number): Promise<string> {
  let slug = baseSlug;
  let counter = 1;
  while (true) {
    // @ts-ignore
    const existing = await prisma.blogCategory.findUnique({
      where: { merchantId_slug: { merchantId, slug } },
      select: { id: true },
    });
    if (!existing || (excludeId && existing.id === excludeId)) return slug;
    counter++;
    slug = `${baseSlug}-${counter}`;
  }
}

// ─── Blog Posts ──────────────────────────────────────────

// GET /posts — list merchant's posts
router.get('/posts', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const { status, page = '1', limit = '20' } = req.query;
    const skip = (Math.max(1, Number(page)) - 1) * Number(limit);
    const take = Math.min(50, Math.max(1, Number(limit)));

    const where: any = { merchantId };
    if (status && ['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(status as string)) {
      where.status = status;
    }

    // @ts-ignore
    const [posts, total] = await Promise.all([
      prisma.blogPost.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: { category: { select: { id: true, name: true, slug: true } } },
      }),
      prisma.blogPost.count({ where }),
    ]);

    res.json({ posts, total, page: Number(page), limit: take });
  } catch (e) {
    console.error('List blog posts failed', e);
    res.status(500).json({ error: 'Failed to fetch blog posts' });
  }
});

// GET /posts/:postId — single post
router.get('/posts/:postId', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const postId = Number(req.params.postId);
    if (!Number.isFinite(postId)) return res.status(400).json({ error: 'Invalid postId' });

    // @ts-ignore
    const post = await prisma.blogPost.findFirst({
      where: { id: postId, merchantId },
      include: { category: { select: { id: true, name: true, slug: true } } },
    });

    if (!post) return res.status(404).json({ error: 'Blog post not found' });
    res.json({ post });
  } catch (e) {
    console.error('Get blog post failed', e);
    res.status(500).json({ error: 'Failed to fetch blog post' });
  }
});

// POST /posts — create post
router.post('/posts', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const { title, excerpt, content, coverImageUrl, imageUrls, tags, categoryId, status } = req.body;

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return res.status(400).json({ error: 'Title is required' });
    }
    if (!content || typeof content !== 'string' || content.trim().length === 0) {
      return res.status(400).json({ error: 'Content is required' });
    }

    const slug = await uniqueSlug(merchantId, slugify(title.trim()));
    const postStatus = status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT';

    // @ts-ignore
    const post = await prisma.blogPost.create({
      data: {
        merchantId,
        title: title.trim(),
        slug,
        excerpt: excerpt ? String(excerpt).trim().slice(0, 500) : null,
        content: content.trim(),
        coverImageUrl: coverImageUrl || null,
        imageUrls: Array.isArray(imageUrls) ? imageUrls : [],
        tags: Array.isArray(tags) ? tags.map((t: string) => String(t).trim()).filter(Boolean).slice(0, 10) : [],
        status: postStatus,
        categoryId: categoryId ? Number(categoryId) : null,
        publishedAt: postStatus === 'PUBLISHED' ? new Date() : null,
      },
      include: { category: { select: { id: true, name: true, slug: true } } },
    });

    res.status(201).json({ post });
  } catch (e) {
    console.error('Create blog post failed', e);
    res.status(500).json({ error: 'Failed to create blog post' });
  }
});

// PUT /posts/:postId — update post
router.put('/posts/:postId', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const postId = Number(req.params.postId);
    if (!Number.isFinite(postId)) return res.status(400).json({ error: 'Invalid postId' });

    // @ts-ignore
    const existing = await prisma.blogPost.findFirst({ where: { id: postId, merchantId } });
    if (!existing) return res.status(404).json({ error: 'Blog post not found' });

    const { title, excerpt, content, coverImageUrl, imageUrls, tags, categoryId, status } = req.body;
    const data: any = {};

    if (title !== undefined) {
      if (!title || typeof title !== 'string') return res.status(400).json({ error: 'Title cannot be empty' });
      data.title = title.trim();
      data.slug = await uniqueSlug(merchantId, slugify(title.trim()), postId);
    }
    if (excerpt !== undefined) data.excerpt = excerpt ? String(excerpt).trim().slice(0, 500) : null;
    if (content !== undefined) {
      if (!content || typeof content !== 'string') return res.status(400).json({ error: 'Content cannot be empty' });
      data.content = content.trim();
    }
    if (coverImageUrl !== undefined) data.coverImageUrl = coverImageUrl || null;
    if (imageUrls !== undefined) data.imageUrls = Array.isArray(imageUrls) ? imageUrls : [];
    if (tags !== undefined) data.tags = Array.isArray(tags) ? tags.map((t: string) => String(t).trim()).filter(Boolean).slice(0, 10) : [];
    if (categoryId !== undefined) data.categoryId = categoryId ? Number(categoryId) : null;
    if (status !== undefined && ['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(status)) {
      data.status = status;
      if (status === 'PUBLISHED' && !existing.publishedAt) {
        data.publishedAt = new Date();
      }
    }

    // @ts-ignore
    const post = await prisma.blogPost.update({
      where: { id: postId },
      data,
      include: { category: { select: { id: true, name: true, slug: true } } },
    });

    res.json({ post });
  } catch (e) {
    console.error('Update blog post failed', e);
    res.status(500).json({ error: 'Failed to update blog post' });
  }
});

// DELETE /posts/:postId
router.delete('/posts/:postId', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const postId = Number(req.params.postId);
    if (!Number.isFinite(postId)) return res.status(400).json({ error: 'Invalid postId' });

    // @ts-ignore
    const existing = await prisma.blogPost.findFirst({ where: { id: postId, merchantId } });
    if (!existing) return res.status(404).json({ error: 'Blog post not found' });

    // @ts-ignore
    await prisma.blogPost.delete({ where: { id: postId } });
    res.json({ message: 'Blog post deleted' });
  } catch (e) {
    console.error('Delete blog post failed', e);
    res.status(500).json({ error: 'Failed to delete blog post' });
  }
});

// PUT /posts/:postId/publish
router.put('/posts/:postId/publish', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const postId = Number(req.params.postId);
    // @ts-ignore
    const existing = await prisma.blogPost.findFirst({ where: { id: postId, merchantId } });
    if (!existing) return res.status(404).json({ error: 'Blog post not found' });

    // @ts-ignore
    const post = await prisma.blogPost.update({
      where: { id: postId },
      data: { status: 'PUBLISHED', publishedAt: existing.publishedAt || new Date() },
      include: { category: { select: { id: true, name: true, slug: true } } },
    });

    res.json({ post });
  } catch (e) {
    console.error('Publish blog post failed', e);
    res.status(500).json({ error: 'Failed to publish blog post' });
  }
});

// PUT /posts/:postId/unpublish
router.put('/posts/:postId/unpublish', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const postId = Number(req.params.postId);
    // @ts-ignore
    const existing = await prisma.blogPost.findFirst({ where: { id: postId, merchantId } });
    if (!existing) return res.status(404).json({ error: 'Blog post not found' });

    // @ts-ignore
    const post = await prisma.blogPost.update({
      where: { id: postId },
      data: { status: 'DRAFT' },
      include: { category: { select: { id: true, name: true, slug: true } } },
    });

    res.json({ post });
  } catch (e) {
    console.error('Unpublish blog post failed', e);
    res.status(500).json({ error: 'Failed to unpublish blog post' });
  }
});

// ─── Blog Categories ──────────────────────────────────────

// GET /categories
router.get('/categories', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    // @ts-ignore
    const categories = await prisma.blogCategory.findMany({
      where: { merchantId },
      orderBy: { sortOrder: 'asc' },
      include: { _count: { select: { posts: true } } },
    });

    res.json({ categories });
  } catch (e) {
    console.error('List blog categories failed', e);
    res.status(500).json({ error: 'Failed to fetch blog categories' });
  }
});

// POST /categories
router.post('/categories', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const { name, description } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'Category name is required' });
    }

    const slug = await uniqueCategorySlug(merchantId, slugify(name.trim()));

    // @ts-ignore
    const category = await prisma.blogCategory.create({
      data: {
        merchantId,
        name: name.trim(),
        slug,
        description: description ? String(description).trim() : null,
      },
    });

    res.status(201).json({ category });
  } catch (e) {
    console.error('Create blog category failed', e);
    res.status(500).json({ error: 'Failed to create blog category' });
  }
});

// PUT /categories/:categoryId
router.put('/categories/:categoryId', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const categoryId = Number(req.params.categoryId);
    // @ts-ignore
    const existing = await prisma.blogCategory.findFirst({ where: { id: categoryId, merchantId } });
    if (!existing) return res.status(404).json({ error: 'Category not found' });

    const { name, description } = req.body;
    const data: any = {};
    if (name !== undefined) {
      if (!name || typeof name !== 'string') return res.status(400).json({ error: 'Name cannot be empty' });
      data.name = name.trim();
      data.slug = await uniqueCategorySlug(merchantId, slugify(name.trim()), categoryId);
    }
    if (description !== undefined) data.description = description ? String(description).trim() : null;

    // @ts-ignore
    const category = await prisma.blogCategory.update({ where: { id: categoryId }, data });
    res.json({ category });
  } catch (e) {
    console.error('Update blog category failed', e);
    res.status(500).json({ error: 'Failed to update blog category' });
  }
});

// DELETE /categories/:categoryId
router.delete('/categories/:categoryId', protect, isMerchant, async (req: AuthRequest, res) => {
  try {
    const merchantId = req.merchant?.id;
    if (!merchantId) return res.status(401).json({ error: 'Merchant authentication required' });

    const categoryId = Number(req.params.categoryId);
    // @ts-ignore
    const existing = await prisma.blogCategory.findFirst({ where: { id: categoryId, merchantId } });
    if (!existing) return res.status(404).json({ error: 'Category not found' });

    // @ts-ignore
    await prisma.blogCategory.delete({ where: { id: categoryId } });
    res.json({ message: 'Category deleted' });
  } catch (e) {
    console.error('Delete blog category failed', e);
    res.status(500).json({ error: 'Failed to delete blog category' });
  }
});

export default router;
