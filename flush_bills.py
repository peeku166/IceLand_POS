import os
from sqlalchemy import text
from app import app, db, Bill, BillItem

def flush_bills():
    """
    Deletes ALL bills and bill items from the database.
    Does NOT delete users or menu items.
    Resets the auto-increment sequence to 1.
    """
    confirmation = input("⚠️  WARNING: This will PERMANENTLY DELETE all sales history (Bills & BillItems).\nType 'YES' to confirm: ")
    if confirmation.strip() != 'YES':
        print("Operation cancelled.")
        return

    print("Flushing database bills...")
    try:
        # 1. Delete all rows
        num_items = db.session.query(BillItem).delete()
        num_bills = db.session.query(Bill).delete()
        db.session.commit()
        
        # 2. Reset Auto-Increment Sequence
        # Attempt to detect DB type from URI
        db_uri = app.config['SQLALCHEMY_DATABASE_URI']
        
        if 'sqlite' in db_uri:
            # SQLite Reset
            db.session.execute(text("DELETE FROM sqlite_sequence WHERE name='bill';"))
            db.session.execute(text("DELETE FROM sqlite_sequence WHERE name='bill_item';"))
        else:
            # PostgreSQL Reset (Neon/Render)
            # Standard naming convention for serial is table_id_seq
            db.session.execute(text("ALTER SEQUENCE bill_id_seq RESTART WITH 1;"))
            db.session.execute(text("ALTER SEQUENCE bill_item_id_seq RESTART WITH 1;"))
            
        db.session.commit()
        
        print(f"✅ Success! Deleted {num_items} items and {num_bills} bills.")
        print("✅ Counter reset to IL00001.")
        
    except Exception as e:
        db.session.rollback()
        print(f"❌ Error: {e}")
        print("Tip: If using Postgres, ensure sequence names are default (bill_id_seq).")

if __name__ == "__main__":
    with app.app_context():
        # Print current DB to be sure
        print(f"Target Database: {app.config['SQLALCHEMY_DATABASE_URI']}")
        flush_bills()
