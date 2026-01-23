from flask import Flask, render_template, request, redirect, url_for, session, jsonify
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import func, extract
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, date, timedelta

import os
from dotenv import load_dotenv

load_dotenv()  # Load variables from .env if present

app = Flask(__name__)
app.config['SECRET_KEY'] = 'change-this-secret-key'  # change in production

# DB Configuration
# 1. Try to get DATABASE_URL from environment (Cloud)
# 2. Fallback to local SQLite
database_url = os.getenv('DATABASE_URL')

if database_url:
    # Fix for SQLAlchemy 1.4+ which deprecated 'postgres://'
    if database_url.startswith("postgres://"):
        database_url = database_url.replace("postgres://", "postgresql://", 1)
    app.config['SQLALCHEMY_DATABASE_URI'] = database_url
else:
    app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///icecream.db'

app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

from werkzeug.security import generate_password_hash


# ---------- Models ----------

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), default='staff')  # 'admin' or 'staff'

    def set_password(self, password):
        # Use pbkdf2:sha256 instead of default scrypt (for compatibility)
        self.password_hash = generate_password_hash(password, method="pbkdf2:sha256")

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class Item(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    product_code = db.Column(db.String(20), unique=True, nullable=False)  # human-friendly code / SKU
    name = db.Column(db.String(100), nullable=False)
    price = db.Column(db.Float, nullable=False)  # GST inclusive
    category = db.Column(db.String(50), nullable=False)  # Scoops, Sundaes, Cones, Extras


class Bill(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    seq_code = db.Column(db.String(20), unique=True)  # e.g. IL00001
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    customer_name = db.Column(db.String(100))
    total_amount = db.Column(db.Float, nullable=False)  # GST inclusive
    status = db.Column(db.String(20), default='ACTIVE', nullable=False)  # ACTIVE / REFUNDED / CANCELLED
    note = db.Column(db.String(255))  # reason for refund/cancel, optional
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    user = db.relationship('User', backref='bills')


class BillItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    bill_id = db.Column(db.Integer, db.ForeignKey('bill.id'))
    item_id = db.Column(db.Integer, db.ForeignKey('item.id'))
    quantity = db.Column(db.Integer, nullable=False)
    refunded_qty = db.Column(db.Integer, default=0)  # how many from this line are refunded
    line_total = db.Column(db.Float, nullable=False)

    bill = db.relationship('Bill', backref='items')
    item = db.relationship('Item')


# ---------- Seed data ----------

def seed_data():
    # Seed admin user if not exists
    # NOTE: If admin exists with old default password (admin123), upgrade it to Iceland@2025.
    admin = User.query.filter_by(username='admin').first()
    if not admin:
        admin = User(username='admin', role='admin')
        admin.set_password('Iceland@2025')
        db.session.add(admin)
    else:
        # One-time upgrade path: only change if the password is still the old default.
        try:
            if admin.check_password('admin123'):
                admin.set_password('Iceland@2025')
        except Exception:
            # If hashing format differs, do not block startup.
            pass

    # Seed staff user Amar if not exists
    if not User.query.filter_by(username='amar').first():
        amar = User(username='amar', role='staff')
        amar.set_password('amar123')
        db.session.add(amar)

    # Seed menu items (with product codes)
    if Item.query.count() == 0:
        # Product codes: SC = Scoop, SU = Sundae, CO = Cone, EX = Extra
        items = [
            # Scoops - Classic (single only, GST inclusive)
            ('SC-001', 'Scoops', 'Vanilla Voyage', 40),
            ('SC-002', 'Scoops', 'Choco Carnival', 40),
            ('SC-003', 'Scoops', 'Strawberry Bliss', 40),
            ('SC-004', 'Scoops', 'Mango Magic', 40),
            ('SC-005', 'Scoops', 'Butterscotch Crunch', 40),
            ('SC-006', 'Scoops', 'Coffee Rush', 40),
            ('SC-007', 'Scoops', 'Majestic Pista', 40),
            ('SC-008', 'Scoops', 'Epic Two-in-One Vanilla-Strawberry', 40),
            ('SC-009', 'Scoops', 'Epic Two-in-One Vanilla-Chocolate', 40),
            ('SC-010', 'Scoops', 'Black Currant Burst', 40),
            # Fruity Exotic
            ('SC-011', 'Scoops', 'Fancy Pineapple', 50),
            ('SC-012', 'Scoops', 'Guava Breeze', 50),
            ('SC-013', 'Scoops', 'Lychee Love', 50),
            ('SC-014', 'Scoops', 'Fig & Honey Hug', 50),
            ('SC-015', 'Scoops', 'Peach Paradise', 50),
            ('SC-016', 'Scoops', 'Sitaphal Symphony', 50),
            # Premium & Exotic
            ('SC-017', 'Scoops', 'Lovely Red Velvet', 60),
            ('SC-018', 'Scoops', 'Blueberry Blast', 60),
            ('SC-019', 'Scoops', 'Avocado Treat', 60),
            ('SC-020', 'Scoops', 'Tender Coconut Treasure', 60),
            ('SC-021', 'Scoops', 'Passion Fruit Punch', 60),
            ('SC-022', 'Scoops', 'Jackfruit Fiesta', 60),
            ('SC-023', 'Scoops', 'Kiwi Kick', 60),
            ('SC-024', 'Scoops', 'Kesar Badam Pista Royal', 60),
            ('SC-025', 'Scoops', 'Oreo Crunch', 60),
            ('SC-026', 'Scoops', 'Blissful Strawberry Cheesecake', 60),
            ('SC-027', 'Scoops', 'Royal Spanish Delight', 60),

            # Sundaes
            ('SU-001', 'Sundaes', 'Death By Chocolate (DBC)', 150),
            ('SU-002', 'Sundaes', 'Royal Jamoon Treat', 100),
            ('SU-003', 'Sundaes', '7 Wonders Sundae', 180),
            ('SU-004', 'Sundaes', '5 Wonders Sundae', 140),
            ('SU-005', 'Sundaes', 'Tiramisu Temptation', 150),
            ('SU-006', 'Sundaes', 'Blueberry Bliss Sundae', 140),
            ('SU-007', 'Sundaes', 'Oreo Cookies & Cream Crush', 120),
            ('SU-008', 'Sundaes', 'Red Velvet Love', 70),
            ('SU-009', 'Sundaes', 'Purple Velvet Magic', 70),
            ('SU-010', 'Sundaes', 'Chocovelvet Bliss', 70),

            # Cones
            ('CO-001', 'Cones', 'Nutty Vanilla Cone', 90),
            ('CO-002', 'Cones', 'Berry Strawberry Cone', 90),
            ('CO-003', 'Cones', 'Royal Mango Cone', 90),
            ('CO-004', 'Cones', 'Choco Crunch Cone', 90),
            ('CO-005', 'Cones', 'Butterscotch Gold Cone', 120),
            ('CO-006', 'Cones', 'Velvet Dream Cone', 100),
            ('CO-007', 'Cones', 'Classic Coffee Cone', 120),
            ('CO-008', 'Cones', 'Blueberry Cone Blast', 100),
            ('CO-009', 'Cones', 'Coconut Paradise Cone', 100),
            ('CO-010', 'Cones', 'Black Currant Rock Cone', 110),
            ('CO-011', 'Cones', 'Oreo Madness Cone', 110),
            ('CO-012', 'Cones', 'Royal Pista Cone', 120),
            ('CO-013', 'Cones', 'Spanish Delight Cone', 120),

            # Extras
            ('EX-001', 'Extras', 'Parcel Charge', 5),
            ('EX-002', 'Extras', 'Water Bottle', 10),
            ('EX-003', 'Extras', 'Cone', 35),
        ]

        for code, cat, name, price in items:
            db.session.add(Item(product_code=code, category=cat, name=name, price=price))

    # Ensure Cone exists even if DB already had items seeded earlier
    cone = Item.query.filter_by(product_code='EX-003').first()
    if not cone:
        # Avoid duplicates if someone added Cone manually without code
        existing_by_name = Item.query.filter_by(category='Extras', name='Cone').first()
        if not existing_by_name:
            db.session.add(Item(product_code='EX-003', category='Extras', name='Cone', price=35))

    db.session.commit()


def init_db():
    """Create all tables and seed initial data."""
    db.create_all()
    seed_data()


# ---------- 🔒 RENDER / GUNICORN SAFE FIX (ONLY ADDITION) ----------

@app.before_request
def ensure_db_initialized():
    if not getattr(app, "_db_ready", False):
        with app.app_context():
            init_db()
        app._db_ready = True

# ---------- Auth helpers ----------

def login_required(view_func):
    from functools import wraps

    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if 'user_id' not in session:
            return redirect(url_for('login'))
        return view_func(*args, **kwargs)
    return wrapper


def get_current_user():
    if 'user_id' in session:
        return User.query.get(session['user_id'])
    return None


def admin_required(view_func):
    from functools import wraps

    @wraps(view_func)
    def wrapper(*args, **kwargs):
        user = get_current_user()
        if not user or user.role != 'admin':
            return "Forbidden: admin only", 403
        return view_func(*args, **kwargs)
    return wrapper


# ---------- Utility ----------

def serialize_bill(bill: Bill):
    """Return a dict that frontend can use to print/reopen."""
    return {
        'bill_id': bill.id,
        'seq_code': bill.seq_code,
        'created_at': bill.created_at.isoformat() + 'Z',
        'customer_name': bill.customer_name,
        'total_amount': bill.total_amount,
        'status': bill.status,
        'note': bill.note,
        'user': bill.user.username if bill.user else None,
        'items': [
            {
                'bill_item_id': bi.id,
                'code': bi.item.product_code,
                'name': bi.item.name,
                'price': bi.item.price,
                'qty': bi.quantity,
                'refunded_qty': bi.refunded_qty,
                'line_total': bi.line_total,
            }
            for bi in bill.items
        ],
    }


# ---------- Routes ----------

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '').strip()
        user = User.query.filter_by(username=username).first()
        if user and user.check_password(password):
            session['user_id'] = user.id
            return redirect(url_for('pos'))
        return render_template('login.html', error='Invalid username or password')
    return render_template('login.html')


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))


@app.route('/')
@login_required
def pos():
    user = get_current_user()
    return render_template('pos.html', user=user)


@app.route('/admin/reports')
@admin_required
def admin_reports():
    """New Advanced Reporting Dashboard."""
    user = get_current_user()
    return render_template('report.html', user=user, today=date.today())


@app.route('/api/reports/sales')
@admin_required
def api_report_sales():
    """
    Get sales data for a specific range.
    query params: type=daily|monthly|yearly, date=YYYY-MM-DD (or YYYY-MM or YYYY)
    """
    rtype = request.args.get('type', 'daily')
    date_str = request.args.get('date', str(date.today()))

    query = Bill.query.filter(Bill.status == 'ACTIVE')

    try:
        if rtype == 'daily':
            # Format: YYYY-MM-DD
            target_date = datetime.strptime(date_str, '%Y-%m-%d').date()
            start = datetime(target_date.year, target_date.month, target_date.day)
            end = datetime(target_date.year, target_date.month, target_date.day, 23, 59, 59)
            query = query.filter(Bill.created_at >= start, Bill.created_at <= end)

        elif rtype == 'monthly':
            # Format: YYYY-MM
            parts = date_str.split('-')
            year, month = int(parts[0]), int(parts[1])
            query = query.filter(extract('year', Bill.created_at) == year,
                                 extract('month', Bill.created_at) == month)

        elif rtype == 'yearly':
            # Format: YYYY
            year = int(date_str)
            query = query.filter(extract('year', Bill.created_at) == year)

    except ValueError:
        return jsonify({'error': 'Invalid date format'}), 400

    bills = query.order_by(Bill.created_at).all()

    # Aggregate Data
    total_sales = sum(b.total_amount for b in bills)
    bill_count = len(bills)

    # Serialize for table
    bills_data = [{
        'id': b.id,
        'seq_code': b.seq_code,
        'time': b.created_at.isoformat(),
        'total': b.total_amount,
        'staff': b.user.username if b.user else '-'
    } for b in bills]

    return jsonify({
        'total_sales': total_sales,
        'bill_count': bill_count,
        'bills': bills_data
    })


@app.route('/api/reports/items')
@admin_required
def api_report_items():
    """Item-wise sales analysis."""
    # filtering by date range optional, for now return all-time or last 30 days
    # Let's support range filtering same as above if needed, but for now allow 'all'
    start_str = request.args.get('start')
    end_str = request.args.get('end')

    query = db.session.query(
        Item.name,
        Item.product_code,
        Item.category,
        func.sum(BillItem.quantity).label('total_qty'),
        func.sum(BillItem.line_total).label('total_revenue')
    ).join(BillItem, Item.id == BillItem.item_id).join(Bill, Bill.id == BillItem.bill_id)

    query = query.filter(Bill.status == 'ACTIVE')

    if start_str and end_str:
        try:
            s_date = datetime.strptime(start_str, '%Y-%m-%d')
            e_date = datetime.strptime(end_str, '%Y-%m-%d') + timedelta(days=1)
            query = query.filter(Bill.created_at >= s_date, Bill.created_at < e_date)
        except ValueError:
            pass

    results = query.group_by(Item.id).order_by(func.sum(BillItem.quantity).desc()).all()

    data = [{
        'name': r.name,
        'code': r.product_code,
        'category': r.category,
        'qty': r.total_qty,
        'revenue': r.total_revenue
    } for r in results]

    return jsonify(data)


@app.route('/api/reports/analysis')
@admin_required
def api_report_analysis():
    """Analytics for charts."""
    # 1. Category Split
    cat_query = db.session.query(
        Item.category,
        func.sum(BillItem.line_total)
    ).join(BillItem).join(Bill).filter(Bill.status == 'ACTIVE').group_by(Item.category).all()

    cat_data = {c[0]: c[1] for c in cat_query}

    # 2. Last 7 Days Trend
    today = date.today()
    seven_days_ago = today - timedelta(days=6)
    start_dt = datetime.combine(seven_days_ago, datetime.min.time())

    trend_query = db.session.query(
        func.date(Bill.created_at),
        func.sum(Bill.total_amount)
    ).filter(Bill.status == 'ACTIVE', Bill.created_at >= start_dt).group_by(func.date(Bill.created_at)).all()

    # Fill missing dates with 0
    trend_dict = {str(r[0]): r[1] for r in trend_query}
    trend_data = []
    labels = []
    for i in range(7):
        d = seven_days_ago + timedelta(days=i)
        d_str = str(d)
        labels.append(d.strftime('%d-%b'))
        trend_data.append(trend_dict.get(d_str, 0))

    return jsonify({
        'category_split': cat_data,
        'trend_labels': labels,
        'trend_data': trend_data
    })


@app.route('/admin/bills')
@admin_required
def admin_bills_list():
    """Simple search/list page for old bills."""
    user = get_current_user()
    q = (request.args.get('q') or '').strip().upper()

    query = Bill.query.order_by(Bill.created_at.desc())
    if q:
        query = query.filter(Bill.seq_code == q)

    bills = query.limit(50).all()
    return render_template('bills.html', user=user, bills=bills, q=q)


@app.route('/admin/bills/<int:bill_id>')
@admin_required
def admin_bill_detail(bill_id):
    user = get_current_user()
    bill = Bill.query.get_or_404(bill_id)

    # compute remaining qty for each item
    items_with_remaining = []
    for bi in bill.items:
        remaining = bi.quantity - (bi.refunded_qty or 0)
        items_with_remaining.append((bi, remaining))

    return render_template('bill_detail.html', user=user, bill=bill, items_with_remaining=items_with_remaining)


@app.route('/admin')
@admin_required
def admin_dashboard():
    """Simple admin landing page."""
    user = get_current_user()
    return render_template('admin_dashboard.html', user=user)


@app.route('/admin/items', methods=['GET', 'POST'])
@admin_required
def admin_items():
    """Admin-only item price editor."""
    user = get_current_user()

    if request.method == 'POST':
        action = request.form.get('action')
        
        # --- ADD ITEM ---
        if action == 'add':
            code = request.form.get('code', '').strip().upper()
            category = request.form.get('category', '').strip()
            name = request.form.get('name', '').strip()
            price_raw = request.form.get('price', '').strip()
            
            if not (code and category and name and price_raw):
                return render_template('admin_items.html', user=user, items=Item.query.order_by(Item.category, Item.name).all(), error='All fields are required.'), 400
            
            # Check unique code
            if Item.query.filter_by(product_code=code).first():
                return render_template('admin_items.html', user=user, items=Item.query.order_by(Item.category, Item.name).all(), error=f'Product Code {code} already exists.'), 400

            try:
                price = float(price_raw)
            except ValueError:
                return render_template('admin_items.html', user=user, items=Item.query.order_by(Item.category, Item.name).all(), error='Invalid price.'), 400

            db.session.add(Item(product_code=code, category=category, name=name, price=price))
            db.session.commit()
            
        # --- DELETE ITEM ---
        elif action == 'delete':
            item_id = int(request.form.get('item_id', 0))
            item = Item.query.get(item_id)
            if item:
                # Optional: Check if used in bills? 
                # For now allow delete, but it might break analytics if we don't handle nulls.
                # Ideally we should just mark inactive, but user asked for delete.
                # We'll rely on foreign key to set null or cascade if set? 
                # actually FlaskSQLAlchemy default might fail if restricted.
                # Let's check if used in BillItem
                if BillItem.query.filter_by(item_id=item.id).first():
                     return render_template('admin_items.html', user=user, items=Item.query.order_by(Item.category, Item.name).all(), error='Cannot delete item used in past bills. (Database safety)'), 400
                
                db.session.delete(item)
                db.session.commit()

        # --- UPDATE PRICE ---
        elif action == 'update_price':
            item_id = int(request.form.get('item_id', 0) or 0)
            new_price_raw = (request.form.get('price') or '').strip()

            item = Item.query.get_or_404(item_id)
            try:
                new_price = float(new_price_raw)
            except ValueError:
                return render_template('admin_items.html', user=user, items=Item.query.order_by(Item.category, Item.name).all(), error='Invalid price.'), 400

            if new_price < 0:
                return render_template('admin_items.html', user=user, items=Item.query.order_by(Item.category, Item.name).all(), error='Price must be 0 or greater.'), 400

            item.price = new_price
            db.session.commit()

        return redirect(url_for('admin_items'))

    items = Item.query.order_by(Item.category, Item.name).all()
    # Get unique existing categories for suggestion datalist
    categories = sorted(list(set([i.category for i in items])))
    
    return render_template('admin_items.html', user=user, items=items, categories=categories)


# ---------- API endpoints ----------

@app.route('/api/items')
@login_required
def api_items():
    items = Item.query.order_by(Item.category, Item.name).all()
    data = [
        {
            'id': i.id,
            'code': i.product_code,
            'name': i.name,
            'price': i.price,
            'category': i.category
        }
        for i in items
    ]
    return jsonify(data)


@app.route('/api/bills', methods=['POST'])
@login_required
def api_create_bill():
    payload = request.get_json(force=True)
    customer_name = payload.get('customer_name', '').strip()
    items_data = payload.get('items', [])  # list of {item_id, qty}

    if not items_data:
        return jsonify({'error': 'No items in bill'}), 400

    # Compute total from DB prices
    total = 0.0
    bill_items = []

    for entry in items_data:
        item_id = entry.get('item_id')
        qty = int(entry.get('qty', 0))
        if qty <= 0:
            continue
        item = Item.query.get(item_id)
        if not item:
            continue
        line_total = item.price * qty
        total += line_total
        bill_items.append((item, qty, line_total))

    if not bill_items:
        return jsonify({'error': 'No valid items'}), 400

    user = get_current_user()
    bill = Bill(
        customer_name=customer_name or None,
        total_amount=total,
        status='ACTIVE',
        user=user
    )
    db.session.add(bill)
    db.session.flush()  # get bill.id

    # Assign sequential code based on ID: IL00001, IL00002, ...
    if not bill.seq_code:
        bill.seq_code = f"IL{bill.id:05d}"

    for item, qty, line_total in bill_items:
        db.session.add(BillItem(bill_id=bill.id, item_id=item.id, quantity=qty, line_total=line_total))

    db.session.commit()

    return jsonify(serialize_bill(bill))


@app.route('/api/bills/last')
@login_required
def api_last_bill():
    """Return the most recent bill (any user)."""
    bill = Bill.query.order_by(Bill.created_at.desc()).first()
    if not bill:
        return jsonify({'error': 'No bills yet'}), 404
    return jsonify(serialize_bill(bill))


@app.route('/api/bills/<int:bill_id>')
@login_required
def api_get_bill(bill_id):
    bill = Bill.query.get_or_404(bill_id)
    return jsonify(serialize_bill(bill))


@app.route('/api/bills/by_seq/<string:seq_code>')
@login_required
def api_get_bill_by_seq(seq_code):
    code = seq_code.strip().upper()
    bill = Bill.query.filter_by(seq_code=code).first()
    if not bill:
        return jsonify({'error': 'Bill not found'}), 404
    return jsonify(serialize_bill(bill))


@app.route('/admin/bills/<int:bill_id>/status', methods=['POST'])
@admin_required
def admin_update_bill_status(bill_id):
    """
    Admin-only endpoint to change bill status:
    - status: ACTIVE / REFUNDED / CANCELLED
    - note: optional reason
    """
    bill = Bill.query.get_or_404(bill_id)

    # Accept both form and JSON input
    if request.is_json:
        data = request.get_json(force=True)
        new_status = (data.get('status') or '').strip().upper()
        note = (data.get('note') or '').strip()
    else:
        new_status = (request.form.get('status') or '').strip().upper()
        note = (request.form.get('note') or '').strip()

    if new_status not in ('ACTIVE', 'REFUNDED', 'CANCELLED'):
        return jsonify({'error': 'Invalid status'}), 400

    bill.status = new_status
    if note:
        bill.note = note

    db.session.commit()

    if not request.is_json:
        return redirect(url_for('admin_reports'))

    return jsonify({
        'bill_id': bill.id,
        'status': bill.status,
        'note': bill.note,
    })


@app.route('/admin/bills/<int:bill_id>/items/<int:bill_item_id>/refund', methods=['POST'])
@admin_required
def admin_refund_bill_item(bill_id, bill_item_id):
    """
    Refund a specific item line (partial refund).
    - form/json field 'qty': how many units to refund (<= remaining)
    - form/json field 'note': reason (optional, will be appended to bill.note)
    Adjusts:
      - BillItem.refunded_qty
      - Bill.total_amount (subtract refund value)
    """
    bill = Bill.query.get_or_404(bill_id)
    bi = BillItem.query.get_or_404(bill_item_id)

    if bi.bill_id != bill.id:
        return "BillItem does not belong to this bill", 400

    if request.is_json:
        data = request.get_json(force=True)
        qty = int(data.get('qty', 0))
        note = (data.get('note') or '').strip()
    else:
        qty = int(request.form.get('qty', 0))
        note = (request.form.get('note') or '').strip()

    if qty <= 0:
        return "Quantity must be > 0", 400

    already_refunded = bi.refunded_qty or 0
    available = bi.quantity - already_refunded

    if qty > available:
        return f"Cannot refund {qty}. Only {available} left.", 400

    # Calculate refund amount
    unit_price = bi.item.price
    refund_amount = unit_price * qty

    # Update refunded_qty and bill total
    bi.refunded_qty = already_refunded + qty
    bill.total_amount -= refund_amount

    # Append note
    if note:
        extra_note = f"[Item refund BI#{bi.id}: {qty} x {unit_price} = {refund_amount} | {note}]"
        bill.note = (bill.note + " " + extra_note).strip() if bill.note else extra_note

    db.session.commit()

    if request.is_json:
        return jsonify({
            'bill_id': bill.id,
            'bill_item_id': bi.id,
            'new_refunded_qty': bi.refunded_qty,
            'bill_total_amount': bill.total_amount,
        })

    # Browser form: go back to bill detail
    return redirect(url_for('admin_bill_detail', bill_id=bill.id))



if __name__ == '__main__':
    # Initialize DB and seed data before starting the server
    with app.app_context():
        init_db()
    # Using port 5050 so 5000/5001 can be busy
    app.run(debug=True, port=5050)
