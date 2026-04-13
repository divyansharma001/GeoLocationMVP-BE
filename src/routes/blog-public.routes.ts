import { Router } from 'express';
import prisma from '../lib/prisma';

const router = Router();

// GET /merchant/:merchantId — list published posts
router.get('/merchant/:merchantId', async (req, res) => {
  try {
    const merchantId = Number(req.params.merchantId);
    if (!Number.isFinite(merchantId)) return res.status(400).json({ error: 'Invalid merchantId' });

    const { page = '1', limit = '10', category } = req.query;
    const skip = (Math.max(1, Number(page)) - 1) * Number(limit);
    const take = Math.min(20, Math.max(1, Number(limit)));

    const where: any = { merchantId, status: 'PUBLISHED' };
    if (category) {
      where.category = { slug: category as string };
    }

    // @ts-ignore
    const [posts, total] = await Promise.all([
      prisma.blogPost.findMany({
        where,
        orderBy: { publishedAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          title: true,
          slug: true,
          excerpt: true,
          coverImageUrl: true,
          tags: true,
          publishedAt: true,
          category: { select: { id: true, name: true, slug: true } },
        },
      }),
      prisma.blogPost.count({ where }),
    ]);

    res.json({ posts, total, page: Number(page), limit: take });
  } catch (e) {
    console.error('Public list blog posts failed', e);
    res.status(500).json({ error: 'Failed to fetch blog posts' });
  }
});

// GET /merchant/:merchantId/categories — categories with post counts
router.get('/merchant/:merchantId/categories', async (req, res) => {
  try {
    const merchantId = Number(req.params.merchantId);
    if (!Number.isFinite(merchantId)) return res.status(400).json({ error: 'Invalid merchantId' });

    // @ts-ignore
    const categories = await prisma.blogCategory.findMany({
      where: { merchantId },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        _count: { select: { posts: { where: { status: 'PUBLISHED' } } } },
      },
    });

    res.json({ categories });
  } catch (e) {
    console.error('Public list blog categories failed', e);
    res.status(500).json({ error: 'Failed to fetch blog categories' });
  }
});

// GET /:merchantId/:slug — single published post
router.get('/:merchantId/:slug', async (req, res) => {
  try {
    const merchantId = Number(req.params.merchantId);
    const { slug } = req.params;
    if (!Number.isFinite(merchantId) || !slug) {
      return res.status(400).json({ error: 'Invalid parameters' });
    }

    // @ts-ignore
    const post = await prisma.blogPost.findFirst({
      where: { merchantId, slug, status: 'PUBLISHED' },
      include: {
        category: { select: { id: true, name: true, slug: true } },
        merchant: { select: { id: true, businessName: true, logoUrl: true, city: true } },
      },
    });

    if (!post) return res.status(404).json({ error: 'Blog post not found' });
    res.json({ post });
  } catch (e) {
    console.error('Public get blog post failed', e);
    res.status(500).json({ error: 'Failed to fetch blog post' });
  }
});

export default router;
