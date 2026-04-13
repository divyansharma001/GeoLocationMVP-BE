CREATE TYPE "BlogPostStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

CREATE TABLE "BlogCategory" (
    "id" SERIAL NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlogCategory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BlogPost" (
    "id" SERIAL NOT NULL,
    "merchantId" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(220) NOT NULL,
    "excerpt" VARCHAR(500),
    "content" TEXT NOT NULL,
    "coverImageUrl" TEXT,
    "imageUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "BlogPostStatus" NOT NULL DEFAULT 'DRAFT',
    "categoryId" INTEGER,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlogPost_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BlogCategory_merchantId_slug_key" ON "BlogCategory"("merchantId", "slug");
CREATE INDEX "BlogCategory_merchantId_idx" ON "BlogCategory"("merchantId");

CREATE UNIQUE INDEX "BlogPost_merchantId_slug_key" ON "BlogPost"("merchantId", "slug");
CREATE INDEX "BlogPost_merchantId_status_idx" ON "BlogPost"("merchantId", "status");
CREATE INDEX "BlogPost_merchantId_publishedAt_idx" ON "BlogPost"("merchantId", "publishedAt");
CREATE INDEX "BlogPost_categoryId_idx" ON "BlogPost"("categoryId");

ALTER TABLE "BlogCategory"
ADD CONSTRAINT "BlogCategory_merchantId_fkey"
FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BlogPost"
ADD CONSTRAINT "BlogPost_merchantId_fkey"
FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BlogPost"
ADD CONSTRAINT "BlogPost_categoryId_fkey"
FOREIGN KEY ("categoryId") REFERENCES "BlogCategory"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
