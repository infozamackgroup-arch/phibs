# Phibs Luxury Homes website

A Node.js website with an admin area, online bookings and numbered receipts (PLH-001, PLH-002 ...).
It stores everything in PostgreSQL, so edits and bookings survive redeploys.

## What the owner can do without GitHub
Go to `https://YOUR-SITE/admin` and log in. There he can:
- **Bookings:** see every booking, set the status (pending, confirmed, paid, completed, cancelled), record money received, add notes, open the guest's receipt, message them on WhatsApp, download all bookings as a spreadsheet.
- **Website text:** change headings and paragraphs on the home page.
- **Photos:** replace each apartment's main photo, the about and founder pictures, and add or remove gallery photos. Photos are resized in the browser before uploading.
- **Apartments & prices:** price per night, maximum guests, tag and description. The website and new bookings use them straight away.
- **Settings:** phone numbers, email, WhatsApp, caution fee, deposit %, and his own password.

Only text and photos in these areas are editable. Layout and design changes still go through the code.

## Deploy on Render
1. Push this folder to a **private** GitHub repository.
2. On Render create a **PostgreSQL** database in your own account. Copy its **Internal Database URL**.
3. Create a **Web Service** from the repository: Runtime Node, Build Command `npm install`, Start Command `npm start`, Instance type **Starter ($7)**.
4. Add these Environment variables on the web service:
   - `DATABASE_URL` = the Internal Database URL from step 2
   - `ADMIN_USER` = the owner's login name (for example `phibian`)
   - `ADMIN_PASSWORD` = a strong password (at least 10 characters). It is only used the first time the site starts. After that, change it from Settings in the admin area.
   - `NODE_VERSION` = `22`
5. Deploy, open `/admin` and log in. Then make one test booking on `/booking.html` and check it appears under Bookings.
Never put the database URL or passwords in GitHub. Keep them only in Render's Environment settings.

## Moving the old dashboard's records
1. Run `npm install`, then: `OLD_DATABASE_URL="<old connection string>" node scripts/inspect-old-db.js`
   This lists table and column names and row counts only (no guest data). Send that output so the import script can be written to match.
2. Better still, ask the designer for a database backup (`pg_dump`) and restore it into your own Render database, so you do not depend on their account staying open.
3. After the import, the old bookings will appear in the Bookings list. Receipt numbering continues from the highest number (or set a start under Settings).

## Photos missing from this version
`index.html` also refers to `phibs room 2.jpeg`, `phibs room 3.jpeg`, `phibs room 5.jpeg` and `phibs room 6.jpeg`. They were not in the zip. Copy them into the `public` folder, or upload replacements in the admin area (Photos).

## Run it on your computer
`npm install`, then `node server.js`. With no `DATABASE_URL` it uses a local SQLite file in `.data/` for testing. Site: http://localhost:3000, admin: http://localhost:3000/admin
