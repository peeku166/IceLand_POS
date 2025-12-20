from flask import Flask, render_template, request, redirect, url_for, session, jsonify
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from datetime import datetime, date

app = Flask(__name__)
app.config['SECRET_KEY'] = 'change-this-secret-key'  # change in production
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///icecream.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

# ---------- Models ----------

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(50), unique=True, nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.String(20), default='staff')

    def set_password(self, password):
        self.password_hash = generate_password_hash(password, method="pbkdf2:sha256")

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class Item(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    product_code = db.Column(db.String(20), unique=True, nullable=False)
    name = db.Column(db.String(100), nullable=False)
    price = db.Column(db.Float, nullable=False)
    category = db.Column(db.String(50), nullable=False)


class Bill(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    seq_code = db.Column(db.String(20), unique=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    customer_name = db.Column(db.String(100))
    total_amount = db.Column(db.Float, nullable=False)
    status = db.Column(db.String(20), default='ACTIVE', nullable=False)
    note = db.Column(db.String(255))
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
    user = db.relationship('User', backref='bills')


class BillItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    bill_id = db.Column(db.Integer, db.ForeignKey('bill.id'))
    item_id = db.Column(db.Integer, db.ForeignKey('item.id'))
    quantity = db.Column(db.Integer, nullable=False)
    refunded_qty = db.Column(db.Integer, default=0)
    line_total = db.Column(db.Float, nullable=False)

    bill = db.relationship('Bill', backref='items')
    item = db.relationship('Item')


# ---------- Seed Data ----------

def seed_data():
    admin = User.query.filter_by(username='admin').first()
    if not admin:
        admin = User(username='admin', role='admin')
        admin.set_password('Iceland@2025')
        db.session.add(admin)

    if not User.query.filter_by(username='amar').first():
        amar = User(username='amar', role='staff')
        amar.set_password('amar123')
        db.session.add(amar)

    if Item.query.count() == 0:
        items = [
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
            ('EX-001', 'Extras', 'Parcel Charge', 5),
            ('EX-002', 'Extras', 'Water Bottle', 10),
            ('EX-003', 'Extras', 'Cone', 35),
        ]
        for code, cat, name, price in items:
            db.session.add(Item(product_code=code, category=cat, name=name, price=price))

    db.session.commit()


def init_db():
    db.create_all()
    seed_data()


# ---------- Render / Gunicorn SAFE INIT ----------
@app.before_request
def ensure_db_initialized():
    if not getattr(app, "_db_ready", False):
        with app.app_context():
            init_db()
        app._db_ready = True


# ---------- Auth Helpers ----------

def login_required(view_func):
    from functools import wraps
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        if 'user_id' not in session:
            return redirect(url_for('login'))
        return view_func(*args, **kwargs)
    return wrapper


def admin_required(view_func):
    from functools import wraps
    @wraps(view_func)
    def wrapper(*args, **kwargs):
        user = User.query.get(session.get('user_id'))
        if not user or user.role != 'admin':
            return "Forbidden", 403
        return view_func(*args, **kwargs)
    return wrapper


# ---------- Routes ----------

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        user = User.query.filter_by(username=request.form['username']).first()
        if user and user.check_password(request.form['password']):
            session['user_id'] = user.id
            return redirect(url_for('pos'))
        return render_template('login.html', error='Invalid credentials')
    return render_template('login.html')


@app.route('/')
@login_required
def pos():
    return render_template('pos.html')


@app.route('/api/items')
@login_required
def api_items():
    items = Item.query.all()
    return jsonify([{
        'id': i.id,
        'code': i.product_code,
        'name': i.name,
        'price': i.price,
        'category': i.category
    } for i in items])


@app.route('/api/bills', methods=['POST'])
@login_required
def api_create_bill():
    data = request.get_json()
    total = 0
    bill = Bill(total_amount=0, user_id=session['user_id'])
    db.session.add(bill)
    db.session.flush()

    bill.seq_code = f"IL{bill.id:05d}"

    for row in data['items']:
        item = Item.query.get(row['item_id'])
        qty = int(row['qty'])
        line_total = item.price * qty
        total += line_total
        db.session.add(BillItem(
            bill_id=bill.id,
            item_id=item.id,
            quantity=qty,
            line_total=line_total
        ))

    bill.total_amount = total
    db.session.commit()
    return jsonify({'seq_code': bill.seq_code, 'total': total})


# ---------- Main ----------

if __name__ == '__main__':
    with app.app_context():
        init_db()
    app.run(debug=True, port=5050)
