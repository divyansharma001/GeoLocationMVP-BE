# Menu Bulk Upload from Excel/CSV

Date: 2025-10-24  
Status: Implemented

## Purpose

Allow merchants to upload multiple menu items at once using Excel (.xlsx, .xls) or CSV files instead of creating them one by one. This significantly speeds up the onboarding process for merchants with large menus.

## Endpoint

### POST `/api/merchants/me/menu/bulk-upload`

**Authentication**: Required (Merchant token)  
**Content-Type**: `multipart/form-data`

**Request**:
- Form field: `file` (Excel or CSV file)
- Supported formats: `.xlsx`, `.xls`, `.csv`
- Maximum file size: 10MB

**Response** (Success - 201):
```json
{
  "message": "Successfully uploaded 25 menu items",
  "created": 25,
  "totalRows": 25,
  "skipped": 0
}
```

**Response** (Validation Errors - 400):
```json
{
  "error": "Validation failed for some rows",
  "errors": [
    {
      "row": 3,
      "field": "price",
      "message": "Price must be a positive number"
    },
    {
      "row": 5,
      "field": "dealType",
      "message": "dealType must be one of: HAPPY_HOUR_BOUNTY, HAPPY_HOUR_SURPRISE, ..."
    }
  ],
  "totalRows": 25,
  "validRows": 23,
  "errorRows": 2
}
```

## Excel/CSV File Format

### Required Columns

| Column Name | Type | Description | Example |
|------------|------|-------------|---------|
| `name` | String | Menu item name (required) | "Margherita Pizza" |
| `price` | Number | Regular price (required) | 15.99 |
| `category` | String | Menu category (required) | "Pizza" |

### Optional Columns

| Column Name | Type | Description | Example |
|------------|------|-------------|---------|
| `description` | String | Item description | "Classic pizza with fresh mozzarella" |
| `imageUrl` | String | URL to item image | "https://example.com/pizza.jpg" |
| `isHappyHour` | Boolean | Is this a Happy Hour item? | true, false, yes, no, 1, 0 |
| `happyHourPrice` | Number | Happy Hour special price | 12.99 |
| `dealType` | String | Type of deal (see below) | "HAPPY_HOUR_BOUNTY" |
| `validStartTime` | String | Start time in HH:MM format | "17:00" |
| `validEndTime` | String | End time in HH:MM format | "19:00" |
| `validDays` | String | Comma-separated days | "MONDAY,TUESDAY,WEDNESDAY" |
| `isSurprise` | Boolean | Is this a surprise deal? | true, false, yes, no, 1, 0 |
| `surpriseRevealTime` | String | Reveal time in HH:MM | "18:30" |

### Valid Deal Types

- `STANDARD` (default)
- `RECURRING`
- `HAPPY_HOUR_BOUNTY`
- `HAPPY_HOUR_SURPRISE`
- `HAPPY_HOUR_LATE_NIGHT`
- `HAPPY_HOUR_MID_DAY`
- `HAPPY_HOUR_MORNINGS`
- `REDEEM_NOW_BOUNTY`
- `REDEEM_NOW_SURPRISE`

### Valid Days

- `MONDAY`, `TUESDAY`, `WEDNESDAY`, `THURSDAY`, `FRIDAY`, `SATURDAY`, `SUNDAY`
- Use comma-separated values: "MONDAY,WEDNESDAY,FRIDAY"

## Example Excel Template

### Basic Menu Items

| name | price | category | description |
|------|-------|----------|-------------|
| Margherita Pizza | 15.99 | Pizza | Classic tomato and mozzarella |
| Caesar Salad | 9.99 | Salads | Fresh romaine with parmesan |
| Craft Beer | 7.50 | Drinks | Local IPA on tap |

### Happy Hour Items

| name | price | category | isHappyHour | happyHourPrice | dealType | validStartTime | validEndTime | validDays |
|------|-------|----------|-------------|----------------|----------|----------------|--------------|-----------|
| Happy Hour Beer | 8.00 | Drinks | true | 5.00 | HAPPY_HOUR_BOUNTY | 17:00 | 19:00 | MONDAY,TUESDAY,WEDNESDAY,THURSDAY,FRIDAY |
| Late Night Wings | 12.00 | Appetizers | true | 8.00 | HAPPY_HOUR_LATE_NIGHT | 22:00 | 00:00 | FRIDAY,SATURDAY |

### Surprise Deals

| name | price | category | dealType | isSurprise | surpriseRevealTime | validStartTime | validEndTime |
|------|-------|----------|----------|------------|-------------------|----------------|--------------|
| Mystery Burger | 15.00 | Mains | HAPPY_HOUR_SURPRISE | true | 18:30 | 18:00 | 20:00 |

## Usage Examples

### Using cURL

```bash
curl -X POST http://localhost:3000/api/merchants/me/menu/bulk-upload \
  -H "Authorization: Bearer YOUR_MERCHANT_TOKEN" \
  -F "file=@menu_items.xlsx"
```

### Using JavaScript/Fetch

```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);

const response = await fetch('/api/merchants/me/menu/bulk-upload', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${merchantToken}`
  },
  body: formData
});

const result = await response.json();
console.log(result);
```

### Using Postman

1. Set method to `POST`
2. URL: `http://localhost:3000/api/merchants/me/menu/bulk-upload`
3. Headers: Add `Authorization: Bearer YOUR_TOKEN`
4. Body: Select `form-data`
5. Add key `file` (type: File) and select your Excel/CSV file
6. Click Send

## Validation Rules

### Required Fields
- `name`: Must be non-empty string (1-120 characters recommended)
- `price`: Must be positive number > 0
- `category`: Must be non-empty string

### Optional Fields
- `happyHourPrice`: If provided, must be positive number > 0
- `dealType`: Must be one of the valid deal types listed above
- `validStartTime`, `validEndTime`, `surpriseRevealTime`: Must be in HH:MM format (24-hour)
- `validDays`: Must be valid day names, comma-separated
- `isHappyHour`, `isSurprise`: Accepts true/false, yes/no, 1/0 (case insensitive)

### Validation Behavior
- If any row has validation errors, the entire upload is rejected
- All errors are returned with row numbers and field names
- No partial uploads - it's all or nothing to maintain data consistency

## Error Handling

### File Upload Errors
- **No file uploaded**: HTTP 400 - "No file uploaded. Please upload an Excel (.xlsx, .xls) or CSV file."
- **Wrong file type**: HTTP 400 - "Only Excel (.xlsx, .xls) and CSV files are allowed!"
- **File too large**: HTTP 400 - "File size exceeds 10MB limit"
- **Empty file**: HTTP 400 - "The uploaded file is empty or has no valid data."

### Validation Errors
Returns HTTP 400 with detailed error information:
```json
{
  "error": "Validation failed for some rows",
  "errors": [
    { "row": 3, "field": "price", "message": "Price must be a positive number" }
  ],
  "totalRows": 25,
  "validRows": 23,
  "errorRows": 2
}
```

### Authentication Errors
- **No token**: HTTP 401 - "Merchant authentication required"
- **Invalid token**: HTTP 401 - "Invalid token"
- **Not a merchant**: HTTP 403 - "Merchant profile required"

## Best Practices

1. **Prepare Your Template**: Download or create an Excel file with proper column headers
2. **Start Small**: Test with a few items first to ensure your format is correct
3. **Use Consistent Data**: Keep categories and deal types consistent across items
4. **Validate Before Upload**: Check that all required fields are filled and formatted correctly
5. **Image URLs**: Ensure image URLs are publicly accessible and valid
6. **Time Format**: Use 24-hour format (17:00, not 5:00 PM)
7. **Boolean Values**: Use simple values like true/false or yes/no
8. **Backup**: Keep a copy of your Excel file for future updates

## Tips for Large Menus

1. **Break Into Batches**: For menus with 100+ items, upload in batches of 50-100
2. **Category Organization**: Group similar items together for easier management
3. **Consistent Naming**: Use clear, consistent naming conventions
4. **Pricing**: Double-check all prices before uploading
5. **Happy Hour Setup**: Create a separate sheet for Happy Hour items if needed

## Future Enhancements

1. **Update Mode**: Support for updating existing items via Excel
2. **Template Download**: Provide a downloadable Excel template with examples
3. **Image Upload**: Support image upload within Excel (base64 or separate images folder)
4. **Validation Preview**: Preview validation results before final upload
5. **Subcategory Support**: Add subcategory field for better organization
6. **Batch Operations**: Delete or archive multiple items via Excel

## Related Endpoints

- `GET /api/merchants/me/menu` - List all menu items
- `POST /api/merchants/me/menu/item` - Create single item
- `PUT /api/merchants/me/menu/item/:itemId` - Update single item
- `DELETE /api/merchants/me/menu/item/:itemId` - Delete single item

---

Generated: 2025-10-24  
Updated automatically as features are enhanced.
