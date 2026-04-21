#!/usr/bin/env python3
"""
TF-IDF email classifier trainer for IntelliMail.
Trains on: synthetic examples (training.jsonl) + rule-labeled DB emails.
Saves: /opt/intellimail-classifier/data/tfidf_model.joblib
"""
import json
import re
import sqlite3
import sys
from pathlib import Path

import joblib
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.model_selection import cross_val_score

BASE    = Path("/opt/intellimail-classifier")
DATA    = BASE / "data"
DB_PATH = Path("/home/AjayData/xgen-intel/intellimail/intellimail.db")

CATEGORIES = [
    "meeting_request", "financial", "legal", "travel",
    "pitch_deck", "fyi", "rewards_awards", "other"
]

def rule_label(subject, from_addr, body_preview):
    sub  = (subject      or "").lower()
    frm  = (from_addr    or "").lower()
    body = (body_preview or "").lower()[:300]
    all_ = sub + " " + body

    if re.search(r'\bpnr\b|booking confirm|flight booking|hotel reserv|check.in|itinerary|e.ticket|boarding pass', sub):
        return "travel"
    if re.search(r'indigo|spicejet|air india|airindia|vistara|goair|akasa|makemytrip|goibibo|cleartrip|booking\.com|airbnb|hotels\.com|marriott|oyo', frm):
        return "travel"
    if re.search(r'statement|credit card bill|amount due|payment due|emi due|outstanding amount|invoice|receipt|transaction alert', sub):
        return "financial"
    if re.search(r'hdfc|icici|axis bank|sbi|kotak|paytm|razorpay|phonepe|gpay|navi|bajaj finance|cred\.club', frm):
        return "financial"
    if re.search(r'legal notice|without prejudice|take notice|cease and desist|\bnda\b|non.disclosure|arbitration|litigation|summons', sub):
        return "legal"
    if re.search(r'\bmeeting\b|\binvite\b|calendar invite|has invited you|scheduled a|let.s connect|quick call|video call|zoom link|google meet|teams meeting|webex', sub):
        return "meeting_request"
    if re.search(r'\bmeeting\b|\binvite\b|scheduled a|has invited you', body) and \
       re.search(r'zoom|meet|teams|webex|calendly', all_):
        return "meeting_request"
    if re.search(r'invitation to speak|keynote|panelist|speaker.*invitation|one.to.one|1:1|catch.?up|sync.?up|quick chat', sub):
        return "meeting_request"
    if re.search(r'points expir|miles expir|reward.*expir|cashback|loyalty point|bluechip|smartbuy|reward balance|voucher|gift card|award nominat|recognition', sub):
        return "rewards_awards"
    if re.search(r'pitch|investment opportun|series [abcd]|funding round|seeking investment|venture capital|\bvc\b.*fund', sub):
        return "pitch_deck"
    if re.search(r'newsletter|weekly digest|monthly update|round.?up|unsubscribe', all_):
        return "fyi"
    if re.search(r'noreply@|no-reply@|newsletter@|digest@|updates@|mailer@|notifications@|donotreply@', frm):
        return "fyi"
    if re.search(r'\bdigest\b|\bnewsletter\b|\bweekly\b|\bmonthly\b', sub) and \
       not re.search(r'meeting|invoice|statement', sub):
        return "fyi"
    return None

def make_text(subject, from_addr, from_name, preview):
    parts = [subject or "", from_addr or "", from_name or "", (preview or "")[:400]]
    return " ".join(p for p in parts if p).lower()

def load_jsonl():
    texts, labels = [], []
    p = DATA / "training.jsonl"
    if not p.exists():
        return texts, labels
    with open(p) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
                inp = d.get("input", {})
                out = d.get("output", {})
                cat = out.get("category")
                if cat not in CATEGORIES:
                    continue
                text = make_text(inp.get("subject",""), inp.get("from",""), inp.get("from_name",""), inp.get("preview",""))
                texts.append(text)
                labels.append(cat)
            except Exception:
                pass
    return texts, labels

SYNTHETIC = [
    ("Meeting Request: Q1 Planning", "manager@company.com", "Manager", "Let's sync up this week to discuss Q1 goals.", "meeting_request"),
    ("Invitation: Product Demo Thursday", "sales@vendor.com", "Sales Team", "I'd love to show you our product. Can we schedule 30 min?", "meeting_request"),
    ("Quick call to discuss partnership", "partner@startup.io", "Partner", "Would you have 20 minutes this week for a quick call?", "meeting_request"),
    ("Interview Invitation - Senior Developer", "hr@company.com", "HR Team", "We'd like to invite you for an interview on March 10.", "meeting_request"),
    ("Zoom Meeting - Project Kickoff", "pm@agency.com", "Project Manager", "Join Zoom meeting: zoom.us/j/123456. Friday 3pm.", "meeting_request"),
    ("Accepted: Weekly Sync", "calendar@google.com", "Google Calendar", "Your event Weekly Sync has been accepted.", "meeting_request"),
    ("Invitation: Annual Conference 2026", "events@conference.org", "Events Team", "You are invited to speak at our annual conference.", "meeting_request"),
    ("1:1 check-in - can we meet?", "boss@company.com", "Director", "Hey, can we do a quick 1:1 this week?", "meeting_request"),
    ("Teams Meeting: Budget Review", "finance@company.com", "Finance", "Microsoft Teams meeting invite for budget review.", "meeting_request"),
    ("Let's connect - exploring collaboration", "ceo@partner.com", "CEO", "I'd love to explore potential collaboration. Coffee?", "meeting_request"),
    ("Webex Invite: Quarterly Business Review", "leadership@corp.com", "Leadership", "You're invited to the QBR via Webex next Tuesday.", "meeting_request"),
    ("Catch up soon?", "colleague@work.com", "Colleague", "Been a while! Want to catch up over a quick call?", "meeting_request"),
    ("Google Meet: Technical Discussion", "engineer@client.com", "Engineer", "Joining link: meet.google.com/abc-defg. Monday 2pm.", "meeting_request"),
    ("Masterclass Invitation: AI in Business", "events@institute.com", "Institute", "Inviting you to our exclusive masterclass on AI.", "meeting_request"),
    ("Panel Discussion - You're Invited", "organiser@summit.com", "Summit Team", "We'd like you as a panelist at TechSummit 2026.", "meeting_request"),
    ("Sync up on project timeline", "lead@project.com", "Project Lead", "Can we sync up to review the timeline? 30 min?", "meeting_request"),
    ("Declined: Strategy Meeting", "calendar@google.com", "Google Calendar", "Your invitation to Strategy Meeting has been declined.", "meeting_request"),
    ("Cancelled: Weekly Standup Tomorrow", "scrum@team.com", "Scrum Master", "Tomorrow's standup has been cancelled.", "meeting_request"),
    ("Video call to discuss your proposal", "client@bigco.com", "Client", "Let's hop on a video call to go through your proposal.", "meeting_request"),
    ("Calendly: Ajay Sharma has booked a meeting", "no-reply@calendly.com", "Calendly", "New event: 30 min discovery call. March 15 at 4pm.", "meeting_request"),
    ("Your Credit Card Statement is Ready", "statements@hdfcbank.com", "HDFC Bank", "Your October statement. Amount due Rs 24500 by Nov 15.", "financial"),
    ("Invoice #INV-2024-0891 from Freelancer", "billing@freelancer.com", "Freelancer", "Invoice attached. Amount: $450. Due: March 30.", "financial"),
    ("Payment Due: Axis Bank EMI", "emi@axisbank.com", "Axis Bank", "Your EMI of Rs 15000 is due on 5th March. Pay now.", "financial"),
    ("ICICI Bank: Transaction Alert", "alerts@icicibank.com", "ICICI Bank", "Debit of Rs 5000 from your account ending 3421.", "financial"),
    ("Paytm: Cashback received", "noreply@paytm.com", "Paytm", "Rs 250 cashback credited. Valid for 30 days.", "financial"),
    ("Your SBI Account Statement", "statement@sbi.co.in", "SBI", "Monthly account statement attached for February 2026.", "financial"),
    ("Razorpay: Payment received for order", "payment@razorpay.com", "Razorpay", "Payment of Rs 12999 received. Order confirmed.", "financial"),
    ("CRED: Your bill is due", "bills@cred.club", "CRED", "HDFC bill of Rs 8500 due in 3 days. Pay via CRED.", "financial"),
    ("Amazon Pay: Receipt for your purchase", "noreply@amazon.in", "Amazon", "Receipt for Rs 3499 purchase on Amazon.in.", "financial"),
    ("Tax invoice from vendor", "accounts@vendor.com", "Vendor Accounts", "Tax invoice No. 2024-567 for services rendered. GST included.", "financial"),
    ("Outstanding amount reminder", "billing@service.com", "Billing Dept", "This is a reminder that Rs 6700 is outstanding on your account.", "financial"),
    ("Your receipt from Apple", "no_reply@email.apple.com", "Apple", "Receipt for App Store purchase of Rs 899. Dec 20.", "financial"),
    ("Kotak Bank: Card transaction declined", "alerts@kotak.com", "Kotak Bank", "Transaction of Rs 25000 declined at POS terminal.", "financial"),
    ("PhonePe: Money received", "noreply@phonepe.com", "PhonePe", "Rs 2000 received from Rahul Sharma via PhonePe.", "financial"),
    ("Bajaj Finance: Your EMI statement", "emi@bajajfinance.com", "Bajaj Finance", "EMI of Rs 8200 due on 10th. Auto-debit scheduled.", "financial"),
    ("Insurance premium due", "service@licindia.in", "LIC India", "Your annual premium of Rs 45000 is due on March 25.", "financial"),
    ("GST invoice for professional services", "accounts@consultancy.com", "Consultancy", "Invoice INV-2026-034. Amount: Rs 1,20,000 + 18% GST.", "financial"),
    ("Google Workspace invoice", "invoicing@google.com", "Google", "Invoice for Google Workspace Business. $72.00 due March 1.", "financial"),
    ("Overdue payment notice", "collections@lender.com", "Lender", "Your account has an overdue balance of Rs 15000.", "financial"),
    ("Salary credited to your account", "hr@company.com", "HR", "Your salary for February has been credited: Rs 1,25,000.", "financial"),
    ("Legal Notice - Breach of Agreement", "legal@lawfirm.com", "Law Firm", "Without prejudice. Take notice that you have breached clause 4.", "legal"),
    ("NDA for review and signature", "contracts@company.com", "Legal Dept", "Please review the attached NDA and sign by Friday.", "legal"),
    ("Cease and Desist Letter", "ip@legalpartners.com", "Legal Partners", "You are hereby directed to cease using our trademark immediately.", "legal"),
    ("Summons - Court appearance required", "registry@highcourt.in", "High Court", "You are summoned to appear before the court on April 12.", "legal"),
    ("Arbitration Notice - Dispute Reference", "arbitration@adr.org", "ADR Centre", "Formal notice of arbitration proceedings filed against your firm.", "legal"),
    ("Contract renewal - legal review needed", "legal@partner.com", "Partner Legal", "The MSA is up for renewal. Legal review required before March 31.", "legal"),
    ("Non-disclosure agreement - execution copy", "counsel@bigco.com", "Big Co Legal", "Execution copy of NDA attached. Please wet sign and return.", "legal"),
    ("Intellectual property infringement claim", "legal@ip-firm.com", "IP Counsel", "Our client believes you have infringed on patent #US123456.", "legal"),
    ("Litigation update: Case No 456/2026", "advocate@court.com", "Advocate", "Update on your matter before the Commercial Court.", "legal"),
    ("Compliance notice from regulator", "notices@sebi.gov.in", "SEBI", "Show cause notice issued under Section 11 of the Securities Act.", "legal"),
    ("Employment contract - final version", "hr-legal@corp.com", "HR Legal", "Attached is the final employment agreement for your review.", "legal"),
    ("Demand letter for outstanding dues", "legal@recovery.com", "Recovery Legal", "Demand for Rs 5,00,000 outstanding. 7-day notice.", "legal"),
    ("GDPR data breach notification", "legal@datacorp.eu", "Data Corp", "Mandatory notification of data breach affecting 1200 users.", "legal"),
    ("Court order attached for compliance", "bailiff@district-court.in", "District Court", "Please find attached court order No 2026/CV/1234.", "legal"),
    ("Trademark opposition filed", "tm@ipoffice.gov.in", "IP Office", "Opposition No. 1234567 filed against your trademark application.", "legal"),
    ("Your IndiGo booking is confirmed", "no-reply@goindigo.in", "IndiGo", "PNR: ABC123. DEL-BOM. March 15 06:30. E-ticket attached.", "travel"),
    ("Booking Confirmation - Marriott Mumbai", "reservations@marriott.com", "Marriott", "Reservation confirmed. Check-in: March 20. Check-out: March 22.", "travel"),
    ("Your MakeMyTrip itinerary is ready", "noreply@makemytrip.com", "MakeMyTrip", "Your trip to Goa is confirmed. Hotel + flight package.", "travel"),
    ("OYO Rooms: Booking Confirmed", "bookings@oyorooms.com", "OYO", "OYO booking for Bangalore confirmed. Check-in March 10.", "travel"),
    ("Air India: Online Check-in Open", "checkin@airindia.in", "Air India", "Check-in now for your AI-101 flight Delhi-London.", "travel"),
    ("Cleartrip: Your booking is confirmed", "noreply@cleartrip.com", "Cleartrip", "Flight 6E-234 confirmed. PNR: XY9876. Boarding pass attached.", "travel"),
    ("Goibibo hotel confirmation", "noreply@goibibo.com", "Goibibo", "Hotel Le Meridien confirmed for 2 nights. Booking ref: GO123456.", "travel"),
    ("Airbnb: Your reservation is confirmed", "automated@airbnb.com", "Airbnb", "Beach House confirmed for March 25-28. Host: Rahul.", "travel"),
    ("SpiceJet: Ticket confirmation", "noreply@spicejet.com", "SpiceJet", "SG-101 BLR-DEL confirmed. PNR: ABCXYZ. Departure 7:15 AM.", "travel"),
    ("Booking.com: Confirmation #12345678", "noreply@booking.com", "Booking.com", "Your stay at The Oberoi is confirmed. March 12-14.", "travel"),
    ("Vistara: Your e-ticket", "noreply@airvistara.com", "Vistara", "UK-201 DEL-HYD. E-ticket No. 096-1234567890. Seat 14A.", "travel"),
    ("IndiGo: Flight reminder - tomorrow", "no-reply@goindigo.in", "IndiGo", "Your flight 6E-500 departs tomorrow. Web check-in now.", "travel"),
    ("Hotels.com: Your hotel is confirmed", "cs@hotels.com", "Hotels.com", "Hilton Garden Inn confirmed. Confirmation No: 987654321.", "travel"),
    ("Akasa Air: Boarding pass ready", "noreply@akasaair.com", "Akasa Air", "QP-1234 BOM-DEL. Seat 22C. Gate opens 30 min before departure.", "travel"),
    ("IRCTC: Your train ticket is booked", "noreply@irctc.co.in", "IRCTC", "PNR 1234567890. 12951 Mumbai Rajdhani. Berth: A1 23 LB.", "travel"),
    ("Visa approval confirmation", "visas@embassy.gov", "Embassy", "Your visa application has been approved. Valid 6 months.", "travel"),
    ("Travel insurance policy confirmed", "policy@travelinsure.com", "Travel Insure", "Policy No. TI-2026-567 active. Coverage: March 15-30.", "travel"),
    ("GoIbibo: Your cab is booked", "noreply@goibibo.com", "Goibibo", "Airport transfer confirmed for March 15 04:30 AM.", "travel"),
    ("Uber: Trip receipt", "noreply@uber.com", "Uber", "Thanks for riding with Uber. Total: Rs 850. Mumbai Airport.", "travel"),
    ("Flight delay notification", "alerts@airline.com", "Airline", "Your flight has been delayed by 2 hours. New departure 9:30 PM.", "travel"),
    ("Investment Opportunity - Series A Round", "founder@startup.io", "Founder", "We are raising $2M Series A. Deck attached. Looking for strategic investors.", "pitch_deck"),
    ("Pitch: AI platform for healthcare", "ceo@aihealth.com", "CEO", "Seeking $500K seed funding for our AI diagnostic platform.", "pitch_deck"),
    ("Venture funding inquiry", "founder@fintech.in", "Founder", "VC fund opportunity. Series B at $10M valuation. Details attached.", "pitch_deck"),
    ("Investment deck - EdTech startup", "investments@startup.co", "Startup", "We are seeking Series A investment in our edtech platform.", "pitch_deck"),
    ("Funding round: Join as angel investor", "angel@earlystage.com", "Early Stage", "Angel round open. Pre-money valuation $2M. Interest?", "pitch_deck"),
    ("Partnership and investment proposal", "bd@newventure.com", "BD Team", "Proposing equity partnership + co-investment in our platform.", "pitch_deck"),
    ("Seed round closing soon - opportunity", "founder@saas.io", "SaaS Founder", "Seed round 80% subscribed. Last chance to participate.", "pitch_deck"),
    ("Executive summary: Series B funding", "ir@company.com", "Investor Relations", "Enclosed executive summary for our $15M Series B raise.", "pitch_deck"),
    ("Request: 30 min to present our startup", "ceo@newco.com", "CEO", "We'd love 30 min to walk you through our business plan and pitch.", "pitch_deck"),
    ("VC fund co-investment opportunity", "deals@vccapital.com", "VC Capital", "We're syndicating a deal in a deeptech startup. Co-invest?", "pitch_deck"),
    ("Coursera: Week 3 content is now available", "noreply@coursera.org", "Coursera", "Week 3 of Machine Learning course is now available.", "fyi"),
    ("Company Newsletter - February 2026", "newsletter@company.com", "Company", "This month: New hires, product updates, and upcoming events.", "fyi"),
    ("Your weekly digest from LinkedIn", "noreply@linkedin.com", "LinkedIn", "5 articles your connections liked this week.", "fyi"),
    ("System Maintenance Notification", "noreply@sysops.com", "System Ops", "Scheduled maintenance Sunday 2-4 AM. Services may be unavailable.", "fyi"),
    ("New assignment posted: Module 4", "notifications@canvas.com", "Canvas LMS", "Assignment 4 has been posted. Due March 20.", "fyi"),
    ("Monthly product update - March 2026", "product@company.com", "Product Team", "Here is what shipped in March. See full changelog inside.", "fyi"),
    ("GitHub: New pull request on your repo", "noreply@github.com", "GitHub", "A new PR has been opened on main. Review requested.", "fyi"),
    ("Unsubscribe from this list", "marketing@brand.com", "Brand", "You're receiving this because you signed up. Unsubscribe below.", "fyi"),
    ("Annual company town hall - recording", "communications@corp.com", "Comms", "Recording of yesterday's town hall now available to all staff.", "fyi"),
    ("Emeritus: Your course starts Monday", "noreply@emeritus.org", "Emeritus", "Your programme starts Monday. Check course portal for schedule.", "fyi"),
    ("HR Policy Update: Effective April 1", "hr@company.com", "HR", "Updated leave policy now in effect. Please read the attachment.", "fyi"),
    ("Udemy: New courses added this week", "noreply@udemy.com", "Udemy", "Based on your interests: 15 new courses added. Explore now.", "fyi"),
    ("Stack Overflow Weekly Digest", "noreply@stackoverflow.com", "Stack Overflow", "Top questions this week: Python async, Docker networking.", "fyi"),
    ("Google Alert: artificial intelligence", "alerts@google.com", "Google Alerts", "5 new articles about artificial intelligence. See digest.", "fyi"),
    ("Your Jira issues updated", "jira@atlassian.com", "Atlassian Jira", "3 issues assigned to you have been updated. View in Jira.", "fyi"),
    ("Product is now available: iPhone 17", "noreply@apple.com", "Apple", "The product you waitlisted is now available for purchase.", "fyi"),
    ("Security alert: New sign-in detected", "security@google.com", "Google Security", "A new device signed in to your account from Delhi, India.", "fyi"),
    ("AWS: Service quota increase approved", "aws-notifications@amazon.com", "AWS", "Your request for higher EC2 quota has been approved.", "fyi"),
    ("Slack: You have 12 unread mentions", "feedback@slack.com", "Slack", "Weekly summary: 12 mentions, 4 channels active.", "fyi"),
    ("Your Medium weekly digest", "noreply@medium.com", "Medium", "Top stories for you this week based on your reading history.", "fyi"),
    ("Your Reward Points are expiring soon", "rewards@hdfc.com", "HDFC Rewards", "5,000 reward points expire March 31. Redeem now.", "rewards_awards"),
    ("IndiGo 6E Rewards: Miles expiring", "rewards@goindigo.in", "IndiGo", "2,500 BluChip miles expire April 15. Book now.", "rewards_awards"),
    ("Amazon: Cashback earned on your order", "rewards@amazon.in", "Amazon", "Rs 500 cashback earned. Applied to your next order.", "rewards_awards"),
    ("You've been nominated for Employee of the Month", "awards@company.com", "HR Awards", "Congratulations! You've been nominated. Winners announced Friday.", "rewards_awards"),
    ("Voucher: Rs 1000 credit in your account", "offers@flipkart.com", "Flipkart", "Rs 1000 SuperCoin voucher added. Valid for 30 days.", "rewards_awards"),
    ("SBI Card: Reward points balance update", "rewards@sbi.co.in", "SBI Cards", "Your current reward balance: 12,450 points = Rs 3,112.", "rewards_awards"),
    ("Loyalty reward: Free upgrade on next stay", "loyalty@marriott.com", "Marriott Bonvoy", "Your Platinum status earns a free suite upgrade. Book now.", "rewards_awards"),
    ("Award nomination: Industry Leader 2026", "awards@industry.org", "Industry Awards", "You've been shortlisted for Industry Leader Award 2026.", "rewards_awards"),
    ("Gift card earned from referral program", "rewards@company.com", "Company", "You earned a Rs 500 Amazon gift card for referring a friend.", "rewards_awards"),
    ("Paytm: Scratch card won!", "noreply@paytm.com", "Paytm", "You've won Rs 150 cashback. Scratch your card in the app.", "rewards_awards"),
    ("Following up on our last conversation", "contact@someone.com", "Contact", "Just wanted to follow up on what we discussed last week.", "other"),
    ("Introduction: New team member joining", "hr@company.com", "HR", "Please welcome Sarah who joins the product team on Monday.", "other"),
    ("Re: Project update", "colleague@work.com", "Colleague", "Thanks for the update. I will review and get back to you.", "other"),
    ("Request for your feedback", "survey@service.com", "Service Team", "We'd love your feedback on your recent experience.", "other"),
    ("Happy Diwali from our team", "greetings@company.com", "Company", "Wishing you and your family a Happy Diwali and prosperous year.", "other"),
    ("Your OTP for login", "noreply@platform.com", "Platform", "Your one-time password is 847291. Valid for 10 minutes.", "other"),
    ("Password reset request", "security@service.com", "Security", "A password reset was requested for your account. Click here.", "other"),
    ("Your order has been shipped", "orders@shop.com", "Shop", "Your order #12345 has been shipped via FedEx. Track here.", "other"),
    ("Thank you for attending our webinar", "events@company.com", "Events", "Thank you for joining our webinar. Recording available here.", "other"),
    ("Job Application: Software Engineer", "careers@bigco.com", "Careers", "Thank you for applying. We'll review and get back to you.", "other"),
    ("Referral: Introducing you to our team", "someone@company.com", "Referrer", "I'd like to introduce you to my colleague at BigCo.", "other"),
    ("Document shared with you", "drive-shares@google.com", "Google Drive", "John Smith shared 'Q1 Report.pdf' with you.", "other"),
    ("Account verification required", "noreply@service.com", "Service", "Please verify your email to complete account setup.", "other"),
    ("Event reminder: Tech Conference Tomorrow", "events@techconf.com", "TechConf", "Reminder: Tech Conference starts tomorrow. Venue: BKC Mumbai.", "other"),
    ("Your report is ready to download", "reports@analytics.com", "Analytics", "Your monthly analytics report for February is ready.", "other"),
]

def load_synthetic():
    texts, labels = [], []
    for subj, frm, name, preview, cat in SYNTHETIC:
        text = make_text(subj, frm, name, preview)
        texts.append(text)
        labels.append(cat)
    return texts, labels

def load_db_emails():
    texts, labels = [], []
    if not DB_PATH.exists():
        print(f"  DB not found at {DB_PATH}")
        return texts, labels
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            "SELECT subject, from_address, from_name, body_text FROM emails LIMIT 5000"
        ).fetchall()
        print(f"  Found {len(rows)} emails in DB")
        labeled = 0
        for row in rows:
            label = rule_label(
                row["subject"] or "",
                row["from_address"] or "",
                (row["body_text"] or "")[:300]
            )
            if label:
                text = make_text(
                    row["subject"] or "",
                    row["from_address"] or "",
                    row["from_name"] or "",
                    (row["body_text"] or "")[:400]
                )
                texts.append(text)
                labels.append(label)
                labeled += 1
        print(f"  Rule-labeled {labeled} emails from DB")
    finally:
        conn.close()
    return texts, labels

def train():
    print("Loading training data...")
    t1, l1 = load_jsonl()
    print(f"  training.jsonl: {len(t1)} examples")
    t2, l2 = load_synthetic()
    print(f"  Synthetic examples: {len(t2)}")
    t3, l3 = load_db_emails()

    texts  = t1 + t2 + t3
    labels = l1 + l2 + l3
    print(f"\nTotal training examples: {len(texts)}")
    from collections import Counter
    for cat, cnt in sorted(Counter(labels).items()):
        print(f"  {cat}: {cnt}")

    if len(texts) < 10:
        print("ERROR: Not enough training data.")
        sys.exit(1)

    model = Pipeline([
        ("tfidf", TfidfVectorizer(
            ngram_range=(1, 2),
            max_features=8000,
            min_df=1,
            sublinear_tf=True,
            strip_accents="unicode",
            analyzer="word",
            token_pattern=r"\b[a-zA-Z0-9][a-zA-Z0-9_.-]{1,}\b"
        )),
        ("clf", LogisticRegression(
            C=5.0,
            max_iter=1000,
            class_weight="balanced",
            solver="lbfgs",
            multi_class="multinomial"
        ))
    ])

    if len(texts) >= 30:
        scores = cross_val_score(model, texts, labels, cv=min(5, len(texts)//8), scoring="accuracy")
        print(f"\nCross-validation accuracy: {scores.mean():.3f} (+/- {scores.std():.3f})")

    model.fit(texts, labels)
    out_path = DATA / "tfidf_model.joblib"
    joblib.dump(model, str(out_path))
    print(f"\nModel saved to {out_path}")

    test_cases = [
        ("Meeting scheduled: Zoom call Friday 3pm", "someone@company.com", "", "Please join via Zoom link.", "meeting_request"),
        ("Your HDFC credit card statement", "statements@hdfcbank.com", "HDFC", "Amount due Rs 12000 by March 15.", "financial"),
        ("IndiGo booking confirmation PNR ABCXYZ", "noreply@goindigo.in", "IndiGo", "Your flight is confirmed.", "travel"),
        ("Legal Notice - Breach of Contract", "legal@firm.com", "Law Firm", "Without prejudice. Respond within 14 days.", "legal"),
        ("Series A funding pitch deck", "founder@startup.io", "Founder", "Seeking $2M investment. Deck attached.", "pitch_deck"),
    ]
    print("\nSanity checks:")
    for subj, frm, name, prev, expected in test_cases:
        text = make_text(subj, frm, name, prev)
        pred = model.predict([text])[0]
        proba = model.predict_proba([text])[0].max()
        status = "OK" if pred == expected else "WRONG"
        print(f"  [{status}] '{subj[:45]}' => {pred} ({proba:.2f}) expected={expected}")

    print("\nTraining complete.")

if __name__ == "__main__":
    train()
