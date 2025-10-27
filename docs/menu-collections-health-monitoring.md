# Menu Collections Health Monitoring Guide

## 🏥 **Health Check Methods**

### **1. System Health Endpoints**

#### Basic Health Check
```bash
curl http://localhost:3000/api/health
```

#### Detailed Health Check
```bash
curl http://localhost:3000/api/health/detailed
```

#### Database Readiness
```bash
curl http://localhost:3000/api/ready
```

#### System Metrics
```bash
curl http://localhost:3000/api/metrics
```

### **2. Menu Collections Specific Health Checks**

#### Quick Health Check (JavaScript)
```bash
node scripts/quick-health-check.js
```

#### Comprehensive Health Check (TypeScript)
```bash
npx ts-node scripts/test-menu-collections.ts
```

### **3. Database Health Check**
```bash
npx ts-node scripts/db-health-check.ts
```

## 🔍 **Monitoring Checklist**

### **Database Health**
- [ ] Database connection is active
- [ ] MenuCollection table exists and is accessible
- [ ] MenuCollectionItem table exists and is accessible
- [ ] Foreign key relationships are working
- [ ] Indexes are properly created

### **API Endpoints Health**
- [ ] Merchant menu collections endpoint (`GET /api/merchants/me/menu-collections`)
- [ ] Create collection endpoint (`POST /api/merchants/me/menu-collections`)
- [ ] Update collection endpoint (`PUT /api/merchants/me/menu-collections/:id`)
- [ ] Delete collection endpoint (`DELETE /api/merchants/me/menu-collections/:id`)
- [ ] Collection items management endpoints
- [ ] Public collections endpoint (`GET /api/menu-collections/:merchantId`)

### **Feature Functionality**
- [ ] Collections can be created with menu items
- [ ] Items can be added/removed from collections
- [ ] Custom pricing works correctly
- [ ] Sort ordering functions properly
- [ ] Soft delete works for collections
- [ ] Deal integration with collections works

### **Performance Monitoring**
- [ ] Collection queries execute within acceptable time (< 100ms)
- [ ] Large collections (50+ items) perform well
- [ ] Database indexes are being used effectively
- [ ] Memory usage remains stable

## 🚨 **Common Issues and Solutions**

### **Database Connection Issues**
```bash
# Check if database is running
npx prisma db pull

# Test connection
npx prisma db execute --stdin
# Then type: SELECT 1;
```

### **Schema Issues**
```bash
# Check if migration was applied
npx prisma migrate status

# Apply pending migrations
npx prisma migrate deploy

# Reset database (development only)
npx prisma migrate reset
```

### **API Endpoint Issues**
```bash
# Check if server is running
curl http://localhost:3000/api/health

# Test specific endpoint
curl -H "Authorization: Bearer YOUR_TOKEN" \
     http://localhost:3000/api/merchants/me/menu-collections
```

## 📊 **Health Check Scripts**

### **Quick Health Check Script**
The `scripts/quick-health-check.js` script performs:
1. Database connection test
2. Schema validation
3. Basic CRUD operations
4. Collection item management
5. Data cleanup

### **Comprehensive Health Check Script**
The `scripts/test-menu-collections.ts` script performs:
1. Database connection test
2. Schema validation
3. Test data creation
4. Menu filtering tests
5. Collection CRUD operations
6. Collection item management
7. Deal integration tests
8. Public endpoint simulation
9. Complete cleanup

## 🔧 **Troubleshooting Commands**

### **Check Database Status**
```bash
# PostgreSQL (if using local database)
pg_ctl status

# Check database connection
npx prisma db execute --stdin
```

### **Check Server Logs**
```bash
# View recent logs
tail -f logs/combined-$(date +%Y-%m-%d).log

# View error logs
tail -f logs/error-$(date +%Y-%m-%d).log
```

### **Check Prisma Client**
```bash
# Regenerate Prisma client
npx prisma generate

# Check schema
npx prisma validate
```

## 📈 **Performance Monitoring**

### **Database Query Performance**
```sql
-- Check slow queries
SELECT query, mean_time, calls 
FROM pg_stat_statements 
WHERE query LIKE '%MenuCollection%' 
ORDER BY mean_time DESC;

-- Check table sizes
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables 
WHERE tablename IN ('MenuCollection', 'MenuCollectionItem')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

### **API Response Times**
```bash
# Test endpoint response time
time curl -s http://localhost:3000/api/merchants/me/menu-collections

# Test with authentication
time curl -H "Authorization: Bearer YOUR_TOKEN" \
          -s http://localhost:3000/api/merchants/me/menu-collections
```

## 🎯 **Health Check Automation**

### **Cron Job for Regular Health Checks**
```bash
# Add to crontab for every 5 minutes
*/5 * * * * cd /path/to/GeolocationMVPBackend && node scripts/quick-health-check.js >> logs/health-check.log 2>&1
```

### **Docker Health Check**
```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1
```

## 📋 **Health Check Report Template**

```
Menu Collections Health Check Report
====================================
Date: [DATE]
Time: [TIME]
Server: [SERVER_NAME]

Database Health:
- Connection: ✅/❌
- Response Time: [X]ms
- Schema Status: ✅/❌

API Endpoints:
- Merchant Collections: ✅/❌
- Public Collections: ✅/❌
- Collection Items: ✅/❌

Feature Tests:
- Collection CRUD: ✅/❌
- Item Management: ✅/❌
- Deal Integration: ✅/❌

Performance:
- Average Response Time: [X]ms
- Memory Usage: [X]MB
- Database Queries: [X]ms

Issues Found:
- [List any issues]

Recommendations:
- [List recommendations]
```

## 🚀 **Quick Start Health Check**

To quickly verify everything is working:

```bash
# 1. Start the server
npm run dev

# 2. Run quick health check
node scripts/quick-health-check.js

# 3. Test API endpoints
curl http://localhost:3000/api/health
```

If all checks pass, your Menu Collections feature is healthy and ready for use! 🎉
