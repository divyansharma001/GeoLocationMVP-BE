# Menu Upload Template - Instructions

## Quick Start Guide

### Step 1: Prepare Your Excel File

Create an Excel file (.xlsx) or CSV file with the following columns:

**REQUIRED COLUMNS:**
- `name` - The name of your menu item
- `price` - The regular price (numbers only, e.g., 15.99)
- `category` - The category (e.g., Pizza, Drinks, Appetizers)

**OPTIONAL COLUMNS:**
- `description` - Description of the item
- `imageUrl` - URL to an image of the item
- `isHappyHour` - true/false if this is a happy hour item
- `happyHourPrice` - Special happy hour price
- `dealType` - Type of deal (STANDARD, HAPPY_HOUR_BOUNTY, etc.)
- `validStartTime` - Start time in HH:MM format (e.g., 17:00)
- `validEndTime` - End time in HH:MM format (e.g., 19:00)
- `validDays` - Days when valid (e.g., MONDAY,TUESDAY,FRIDAY)
- `isSurprise` - true/false for surprise deals
- `surpriseRevealTime` - Time to reveal surprise in HH:MM format

### Step 2: Fill In Your Data

Example rows:

```
name                    | price | category    | description                           | isHappyHour | happyHourPrice
Margherita Pizza       | 15.99 | Pizza       | Classic tomato and mozzarella        | false       |
Caesar Salad           | 9.99  | Salads      | Fresh romaine with parmesan          | false       |
Craft Beer             | 8.00  | Drinks      | Local IPA on tap                     | true        | 5.00
Buffalo Wings          | 12.00 | Appetizers  | Spicy wings with ranch               | true        | 8.00
```

### Step 3: Upload Your File

**Using the API:**

```bash
curl -X POST http://localhost:3000/api/merchants/me/menu/bulk-upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "file=@your_menu.xlsx"
```

**Using Postman:**
1. Create new request
2. Method: POST
3. URL: `http://localhost:3000/api/merchants/me/menu/bulk-upload`
4. Headers: `Authorization: Bearer YOUR_TOKEN`
5. Body: form-data
6. Key: `file` (select "File" type)
7. Value: Choose your Excel file
8. Send

### Deal Types Reference

- **STANDARD** - Regular menu item
- **RECURRING** - Recurring deal
- **HAPPY_HOUR_BOUNTY** - Happy Hour bounty - redeem now
- **HAPPY_HOUR_SURPRISE** - Happy Hour surprise deal
- **HAPPY_HOUR_LATE_NIGHT** - Happy Hour late night specials
- **HAPPY_HOUR_MID_DAY** - Happy Hour mid day specials
- **HAPPY_HOUR_MORNINGS** - Happy Hour morning specials
- **REDEEM_NOW_BOUNTY** - Redeem now bounty
- **REDEEM_NOW_SURPRISE** - Redeem now surprise deal

### Common Mistakes to Avoid

1. ❌ Missing required columns (name, price, category)
2. ❌ Using text in price fields (use numbers only: 15.99, not "$15.99")
3. ❌ Wrong time format (use 17:00, not 5:00 PM)
4. ❌ Invalid day names (use MONDAY not Mon or monday)
5. ❌ Wrong boolean format (use true/false, yes/no, or 1/0)
6. ❌ Empty rows in the middle of data
7. ❌ Wrong file format (use .xlsx, .xls, or .csv only)

### Validation Tips

✅ All prices must be positive numbers
✅ Time format must be HH:MM (24-hour format)
✅ Days must be comma-separated: MONDAY,TUESDAY,FRIDAY
✅ Boolean fields accept: true, false, yes, no, 1, 0
✅ Deal types must match exactly (case-insensitive)
✅ File size must be under 10MB

### Example Success Response

```json
{
  "message": "Successfully uploaded 25 menu items",
  "created": 25,
  "totalRows": 25,
  "skipped": 0
}
```

### Example Error Response

```json
{
  "error": "Validation failed for some rows",
  "errors": [
    {
      "row": 3,
      "field": "price",
      "message": "Price must be a positive number"
    }
  ],
  "totalRows": 25,
  "validRows": 23,
  "errorRows": 2
}
```

If you see errors:
1. Check the row number mentioned
2. Fix the field with the error
3. Re-upload the file

### Sample Data Templates

#### Basic Menu (Minimal)
```csv
name,price,category
Margherita Pizza,15.99,Pizza
Caesar Salad,9.99,Salads
Craft Beer,7.50,Drinks
```

#### Happy Hour Menu (Full)
```csv
name,price,category,description,isHappyHour,happyHourPrice,dealType,validStartTime,validEndTime,validDays
Happy Hour Beer,8.00,Drinks,Local IPA on tap,true,5.00,HAPPY_HOUR_BOUNTY,17:00,19:00,"MONDAY,TUESDAY,WEDNESDAY,THURSDAY,FRIDAY"
Late Night Wings,12.00,Appetizers,Spicy buffalo wings,true,8.00,HAPPY_HOUR_LATE_NIGHT,22:00,00:00,"FRIDAY,SATURDAY"
```

### Need Help?

Check the full documentation at `docs/menu-bulk-upload.md`
