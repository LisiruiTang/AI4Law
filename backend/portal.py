"""Persistent examples, administrator accounts, and server-side login sessions."""

from contextlib import contextmanager
import base64
import hashlib
import hmac
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import time

from fastapi import HTTPException, Request

from default_examples import DEFAULT_EXAMPLES


DB_PATH = Path(os.getenv("AI4LAW_DB_PATH", str(Path(__file__).parent / "data" / "portal.sqlite3")))
COOKIE_NAME = "ai4law_session"
PASSWORD_ROUNDS = 600_000
USERNAME_RE = re.compile(r"^[A-Za-z0-9._@+-]{3,40}$")


@contextmanager
def db():
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 10000")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize():
    DB_PATH.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with db() as connection:
        connection.execute("PRAGMA journal_mode = WAL")
        connection.executescript("""
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY, value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS admins (
                id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL, created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY, role TEXT NOT NULL,
                admin_id INTEGER REFERENCES admins(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS examples (
                id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('token', 'beam')),
                name TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
                config_json TEXT NOT NULL, position INTEGER NOT NULL,
                version INTEGER NOT NULL DEFAULT 1,
                created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
                UNIQUE(kind, name)
            );
            CREATE TABLE IF NOT EXISTS login_attempts (
                key TEXT PRIMARY KEY, failures INTEGER NOT NULL,
                window_started INTEGER NOT NULL, blocked_until INTEGER NOT NULL
            );
        """)
        seeded = connection.execute("SELECT 1 FROM settings WHERE key = 'examples_seeded_v1'").fetchone()
        if not seeded:
            now = int(time.time())
            for position, example in enumerate(DEFAULT_EXAMPLES):
                connection.execute(
                    "INSERT OR IGNORE INTO examples "
                    "(kind, name, note, config_json, position, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (example["kind"], example["name"], example.get("note", ""),
                     json.dumps(example["config"], ensure_ascii=False), position, now, now),
                )
            connection.execute(
                "INSERT INTO settings (key, value) VALUES ('examples_seeded_v1', '1')"
            )


def hash_password(password):
    if len(password) < 12 or len(password) > 256:
        raise ValueError("Use a password of 12 to 256 characters.")
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PASSWORD_ROUNDS)
    return "pbkdf2_sha256${}${}${}".format(
        PASSWORD_ROUNDS, base64.urlsafe_b64encode(salt).decode(),
        base64.urlsafe_b64encode(digest).decode(),
    )


def verify_password(password, encoded):
    try:
        algorithm, rounds, salt, expected = encoded.split("$")
        if algorithm != "pbkdf2_sha256" or not 100_000 <= int(rounds) <= 2_000_000:
            return False
        actual = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), base64.urlsafe_b64decode(salt), int(rounds)
        )
        return hmac.compare_digest(actual, base64.urlsafe_b64decode(expected))
    except (ValueError, TypeError):
        return False


def password_required():
    with db() as connection:
        return connection.execute("SELECT 1 FROM settings WHERE key = 'student_password_hash'").fetchone() is not None


def set_student_password(password):
    encoded = hash_password(password)
    with db() as connection:
        connection.execute(
            "INSERT INTO settings (key, value) VALUES ('student_password_hash', ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (encoded,)
        )
        connection.execute("DELETE FROM sessions WHERE role = 'student'")


def verify_student_password(password):
    with db() as connection:
        row = connection.execute(
            "SELECT value FROM settings WHERE key = 'student_password_hash'"
        ).fetchone()
    return bool(row and verify_password(password, row["value"]))


def set_admin_password(username, password):
    if not USERNAME_RE.fullmatch(username):
        raise ValueError("Username must be 3–40 characters and may include an email address.")
    encoded = hash_password(password)
    with db() as connection:
        row = connection.execute("SELECT id FROM admins WHERE username = ?", (username,)).fetchone()
        if row:
            connection.execute("UPDATE admins SET password_hash = ? WHERE id = ?", (encoded, row["id"]))
            connection.execute("DELETE FROM sessions WHERE admin_id = ?", (row["id"],))
            return "updated"
        connection.execute(
            "INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, ?)",
            (username, encoded, int(time.time())),
        )
        return "created"


def verify_admin(username, password):
    with db() as connection:
        row = connection.execute(
            "SELECT id, password_hash FROM admins WHERE username = ?", (username,)
        ).fetchone()
    if row and verify_password(password, row["password_hash"]):
        return row["id"]
    # Unknown usernames still take a password-hash calculation.
    if not row:
        hashlib.pbkdf2_hmac("sha256", password.encode(), b"unknown-admin-salt", PASSWORD_ROUNDS)
    return None


def client_identity(request: Request):
    peer = request.client.host if request.client else "unknown"
    if peer in ("127.0.0.1", "::1"):
        forwarded = request.headers.get("x-real-ip", "")
        try:
            peer = str(ipaddress.ip_address(forwarded))
        except ValueError:
            pass
    return peer


def check_login_limit(key):
    with db() as connection:
        row = connection.execute(
            "SELECT blocked_until FROM login_attempts WHERE key = ?", (key,)
        ).fetchone()
    if row and row["blocked_until"] > int(time.time()):
        raise HTTPException(429, "Too many attempts. Please try again later.")


def record_login_failure(key):
    now = int(time.time())
    with db() as connection:
        row = connection.execute(
            "SELECT failures, window_started FROM login_attempts WHERE key = ?", (key,)
        ).fetchone()
        failures = row["failures"] + 1 if row and now - row["window_started"] < 900 else 1
        window_started = row["window_started"] if row and now - row["window_started"] < 900 else now
        blocked_until = now + 900 if failures >= 10 else 0
        connection.execute(
            "INSERT INTO login_attempts (key, failures, window_started, blocked_until) "
            "VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET "
            "failures=excluded.failures, window_started=excluded.window_started, "
            "blocked_until=excluded.blocked_until",
            (key, failures, window_started, blocked_until),
        )


def clear_login_failures(key):
    with db() as connection:
        connection.execute("DELETE FROM login_attempts WHERE key = ?", (key,))


def create_session(role, admin_id=None):
    token = secrets.token_urlsafe(32)
    ttl = 4 * 3600 if role == "admin" else 12 * 3600
    with db() as connection:
        connection.execute("DELETE FROM sessions WHERE expires_at < ?", (int(time.time()),))
        connection.execute(
            "INSERT INTO sessions (token_hash, role, admin_id, expires_at) VALUES (?, ?, ?, ?)",
            (hashlib.sha256(token.encode()).hexdigest(), role, admin_id, int(time.time()) + ttl),
        )
    return token, ttl


def find_session(token):
    if not token:
        return None
    with db() as connection:
        row = connection.execute(
            "SELECT s.role, s.admin_id, a.username FROM sessions s "
            "LEFT JOIN admins a ON a.id = s.admin_id "
            "WHERE s.token_hash = ? AND s.expires_at > ?",
            (hashlib.sha256(token.encode()).hexdigest(), int(time.time())),
        ).fetchone()
    return dict(row) if row else None


def delete_session(token):
    if token:
        with db() as connection:
            connection.execute(
                "DELETE FROM sessions WHERE token_hash = ?",
                (hashlib.sha256(token.encode()).hexdigest(),),
            )


def get_session(request: Request):
    return find_session(request.cookies.get(COOKIE_NAME))


def require_access(request: Request):
    session = get_session(request)
    if session:
        return session
    if not password_required():
        return {"role": "public", "admin_id": None, "username": None}
    raise HTTPException(401, "Enter the simulator password to continue.")


def require_admin(request: Request):
    session = get_session(request)
    if not session or session["role"] != "admin":
        raise HTTPException(403, "Administrator sign-in required.")
    return session


def same_origin(request: Request):
    """Reject cross-origin browser writes; JSON plus SameSite cookies provides CSRF defense."""
    from urllib.parse import urlsplit

    origin = request.headers.get("origin")
    if origin and urlsplit(origin).netloc != request.headers.get("host"):
        raise HTTPException(403, "Cross-origin request rejected.")


def normalize_example(kind, name, note, config):
    if kind not in ("token", "beam"):
        raise HTTPException(422, "Choose Token Probabilities or Branching Tree.")
    name = name.strip()
    note = note.strip()
    if not name or len(name) > 120 or name.lower() == "blank":
        raise HTTPException(422, "Example name must be 1–120 characters and cannot be Blank.")
    if len(note) > 500:
        raise HTTPException(422, "Note is too long.")
    if not isinstance(config, dict):
        raise HTTPException(422, "Example configuration must be an object.")
    if kind == "token":
        allowed = ("persona", "question", "options", "mode", "contextA", "contextB",
                   "labelA", "labelB", "modelB", "expect", "expectNote")
        result = {}
        for field in allowed:
            value = config.get(field, "")
            if not isinstance(value, str) or len(value) > (5000 if field in ("question", "contextA", "contextB", "persona") else 1000):
                raise HTTPException(422, f"Invalid {field}.")
            result[field] = value
        if result["mode"] not in ("single", "context", "versions", "models"):
            raise HTTPException(422, "Invalid comparison mode.")
        if result["expect"] not in ("", "shift", "null"):
            raise HTTPException(422, "Invalid expectation.")
        if not result["question"].strip() or len([x for x in result["options"].split(",") if x.strip()]) < 2:
            raise HTTPException(422, "Enter a question and at least two answer options.")
    else:
        prompt = config.get("prompt", "")
        k = config.get("k", 3)
        depth = config.get("depth", 6)
        width = config.get("beamWidth", 10)
        minimum = config.get("minLength", 2)
        temperature = config.get("temperature", 1.0)
        if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 5000:
            raise HTTPException(422, "Enter a Branching Tree prompt of up to 5000 characters.")
        if (not isinstance(k, int) or isinstance(k, bool) or not 2 <= k <= 10
                or not isinstance(depth, int) or isinstance(depth, bool) or not 2 <= depth <= 8
                or not isinstance(width, int) or isinstance(width, bool) or not 1 <= width <= 30
                or not isinstance(minimum, int) or isinstance(minimum, bool) or not 1 <= minimum <= depth):
            raise HTTPException(422, "Invalid tree settings.")
        if isinstance(temperature, bool) or temperature not in (0.2, 1.0, 1.8):
            raise HTTPException(422, "Choose Low, Medium, or High variation.")
        result = {"prompt": prompt, "k": k, "depth": depth,
                  "beamWidth": width, "minLength": minimum, "temperature": temperature}
    return kind, name, note, result


def row_to_example(row):
    return {"id": row["id"], "kind": row["kind"], "name": row["name"],
            "note": row["note"], "config": json.loads(row["config_json"]),
            "version": row["version"]}


def list_examples(kind=None):
    if kind not in (None, "token", "beam"):
        raise HTTPException(422, "Invalid example type.")
    with db() as connection:
        if kind:
            rows = connection.execute(
                "SELECT * FROM examples WHERE kind = ? ORDER BY position, id", (kind,)
            ).fetchall()
        else:
            rows = connection.execute("SELECT * FROM examples ORDER BY kind, position, id").fetchall()
    return [row_to_example(row) for row in rows]


def create_example(kind, name, note, config):
    kind, name, note, config = normalize_example(kind, name, note, config)
    now = int(time.time())
    with db() as connection:
        position = connection.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM examples WHERE kind = ?", (kind,)
        ).fetchone()[0]
        try:
            cursor = connection.execute(
                "INSERT INTO examples (kind, name, note, config_json, position, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (kind, name, note, json.dumps(config, ensure_ascii=False), position, now, now),
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "An example with this name already exists in this tab.") from exc
        row = connection.execute("SELECT * FROM examples WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return row_to_example(row)


def update_example(example_id, version, kind, name, note, config):
    kind, name, note, config = normalize_example(kind, name, note, config)
    with db() as connection:
        try:
            cursor = connection.execute(
                "UPDATE examples SET name = ?, note = ?, config_json = ?, "
                "version = version + 1, updated_at = ? "
                "WHERE id = ? AND kind = ? AND version = ?",
                (name, note, json.dumps(config, ensure_ascii=False), int(time.time()),
                 example_id, kind, version),
            )
        except sqlite3.IntegrityError as exc:
            raise HTTPException(409, "An example with this name already exists in this tab.") from exc
        if cursor.rowcount == 0:
            raise HTTPException(409, "This example changed in another administrator session. Reload it before saving.")
        row = connection.execute("SELECT * FROM examples WHERE id = ?", (example_id,)).fetchone()
    return row_to_example(row)


def delete_example(example_id, version):
    with db() as connection:
        cursor = connection.execute(
            "DELETE FROM examples WHERE id = ? AND version = ?", (example_id, version)
        )
        if cursor.rowcount == 0:
            raise HTTPException(409, "This example changed in another administrator session. Reload it before deleting.")


initialize()
