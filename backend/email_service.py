import os
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from dotenv import load_dotenv

load_dotenv()


def send_price_alert(name: str, url: str, old_price: float, new_price: float, direction: str):
    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER")
    smtp_password = os.getenv("SMTP_PASSWORD")
    email_to = os.getenv("EMAIL_TO")

    if not all([smtp_user, smtp_password, email_to]):
        print("[email] SMTP not configured — skipping alert")
        return

    is_decrease = direction == "decrease"
    change_amt = new_price - old_price
    change_pct = (change_amt / old_price) * 100
    arrow = "↓" if is_decrease else "↑"
    verb = "dropped" if is_decrease else "increased"
    accent = "#16a34a" if is_decrease else "#dc2626"
    bg = "#f0fdf4" if is_decrease else "#fef2f2"
    border = "#bbf7d0" if is_decrease else "#fecaca"

    html = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.08);">
    <div style="background:#1e40af;padding:24px 28px;">
      <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;">Price Tracker Alert</h1>
      <p style="color:#bfdbfe;margin:4px 0 0;font-size:13px;">Automated price monitoring</p>
    </div>
    <div style="padding:28px;">
      <p style="color:#374151;font-size:15px;margin:0 0 20px;">
        The price of <strong>{name}</strong> has <strong style="color:{accent};">{verb} {arrow}</strong>
      </p>
      <div style="background:{bg};border:1px solid {border};border-radius:8px;padding:20px;margin-bottom:24px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="color:#6b7280;font-size:13px;padding:4px 0;">Previous price</td>
            <td style="text-align:right;font-size:16px;text-decoration:line-through;color:#9ca3af;">₹{old_price:,.2f}</td>
          </tr>
          <tr>
            <td style="color:#6b7280;font-size:13px;padding:4px 0;">Current price</td>
            <td style="text-align:right;font-size:26px;font-weight:700;color:{accent};">₹{new_price:,.2f}</td>
          </tr>
          <tr>
            <td style="color:#6b7280;font-size:13px;padding:4px 0;">Change</td>
            <td style="text-align:right;font-size:14px;font-weight:600;color:{accent};">{change_pct:+.1f}% (₹{abs(change_amt):,.2f})</td>
          </tr>
        </table>
      </div>
      <a href="{url}"
         style="display:inline-block;background:#1e40af;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">
        View Product →
      </a>
    </div>
    <div style="background:#f8fafc;padding:16px 28px;border-top:1px solid #e5e7eb;">
      <p style="color:#9ca3af;font-size:12px;margin:0;">Sent by Price Tracker · You can adjust alerts in the extension settings.</p>
    </div>
  </div>
</body>
</html>"""

    msg = MIMEMultipart("alternative")
    msg["Subject"] = f"Price {verb.capitalize()}: {name[:50]} — Now ₹{new_price:,.0f}"
    msg["From"] = smtp_user
    msg["To"] = email_to
    msg.attach(MIMEText(html, "html"))

    try:
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.ehlo()
            server.starttls()
            server.login(smtp_user, smtp_password)
            server.sendmail(smtp_user, email_to, msg.as_string())
        print(f"[email] Alert sent for '{name}'")
    except Exception as exc:
        print(f"[email] Failed to send alert: {exc}")
