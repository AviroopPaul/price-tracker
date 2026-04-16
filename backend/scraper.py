import re
import json
import time
import random
import requests
from bs4 import BeautifulSoup

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "en-IN,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
    "DNT": "1",
}


def detect_site(url: str) -> str:
    url_lower = url.lower()
    if "amazon.in" in url_lower or "amazon.com" in url_lower:
        return "amazon"
    if "flipkart.com" in url_lower:
        return "flipkart"
    if "reliancedigital.in" in url_lower:
        return "reliancedigital"
    if "croma.com" in url_lower:
        return "croma"
    if "myntra.com" in url_lower:
        return "myntra"
    if "meesho.com" in url_lower:
        return "meesho"
    return "generic"


def parse_price(text: str) -> float | None:
    if not text:
        return None
    cleaned = re.sub(r"[^\d.]", "", text.replace(",", ""))
    try:
        val = float(cleaned)
        return val if val > 0 else None
    except (ValueError, TypeError):
        return None


def _try_selectors(soup: BeautifulSoup, selectors: list[str]) -> float | None:
    for sel in selectors:
        el = soup.select_one(sel)
        if el:
            price = parse_price(el.get_text(strip=True))
            if price:
                return price
    return None


def scrape_amazon(soup: BeautifulSoup) -> float | None:
    return _try_selectors(soup, [
        "#corePrice_feature_div .a-price .a-offscreen",
        "#apex_desktop .a-price .a-offscreen",
        ".a-price .a-offscreen",
        "#priceblock_ourprice",
        "#priceblock_dealprice",
        "#priceblock_saleprice",
        'span[data-a-color="price"] .a-offscreen',
    ])


def scrape_flipkart(soup: BeautifulSoup) -> float | None:
    return _try_selectors(soup, [
        "._30jeq3._16Jk6d",
        "._30jeq3",
        'div[class*="Nx9bqj"]',
        'div[class*="CEmiEU"]',
        ".CEmiEU > div",
    ])


def scrape_reliancedigital(soup: BeautifulSoup) -> float | None:
    return _try_selectors(soup, [
        ".pdp-price strong",
        '[data-qa="product-price"]',
        ".price strong",
        ".price",
    ])


def scrape_croma(soup: BeautifulSoup) -> float | None:
    return _try_selectors(soup, [
        ".pd-price",
        '[data-testid="pdp-price"]',
        ".amount",
    ])


def scrape_generic(soup: BeautifulSoup) -> float | None:
    # JSON-LD schema.org Product
    for script in soup.find_all("script", type="application/ld+json"):
        try:
            data = json.loads(script.string or "")
            if isinstance(data, list):
                data = data[0]
            if data.get("@type") in ("Product", "IndividualProduct"):
                offers = data.get("offers", {})
                if isinstance(offers, list):
                    offers = offers[0]
                for key in ("price", "lowPrice"):
                    if offers.get(key):
                        p = parse_price(str(offers[key]))
                        if p:
                            return p
        except Exception:
            pass

    # Meta tags
    for sel, attr in [
        ('meta[property="product:price:amount"]', "content"),
        ('meta[property="og:price:amount"]', "content"),
        ('meta[itemprop="price"]', "content"),
    ]:
        el = soup.select_one(sel)
        if el:
            p = parse_price(el.get(attr, ""))
            if p:
                return p

    # Find text nodes with rupee/dollar symbols
    pattern = re.compile(r"[₹$€£]\s*[\d,]+\.?\d*")
    for el in soup.find_all(string=pattern):
        match = pattern.search(el)
        if match:
            p = parse_price(match.group())
            if p and p > 10:
                return p

    return None


def get_product_name(soup: BeautifulSoup, site: str) -> str:
    site_selectors = {
        "amazon": ["#productTitle", "h1.a-size-large"],
        "flipkart": ["span.B_NuCI", ".G6XhRU", "h1"],
        "reliancedigital": ["h1.pdp-title", "h1"],
        "croma": ["h1.pdp-title", "h1.product-title", "h1"],
        "generic": ["h1"],
    }
    selectors = site_selectors.get(site, ["h1"])

    for sel in selectors:
        el = soup.select_one(sel)
        if el:
            text = el.get_text(strip=True)
            if text:
                return text[:120]

    # fallback: og:title
    meta = soup.select_one('meta[property="og:title"]')
    if meta:
        return (meta.get("content") or "")[:120]

    title = soup.find("title")
    return (title.get_text(strip=True) if title else "")[:120]


def fetch_price(url: str) -> dict:
    site = detect_site(url)
    time.sleep(random.uniform(1.0, 2.5))

    session = requests.Session()
    session.headers.update(HEADERS)

    try:
        resp = session.get(url, timeout=20)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "lxml")

        scrapers = {
            "amazon": scrape_amazon,
            "flipkart": scrape_flipkart,
            "reliancedigital": scrape_reliancedigital,
            "croma": scrape_croma,
        }

        price = scrapers.get(site, lambda s: None)(soup)
        if price is None:
            price = scrape_generic(soup)

        name = get_product_name(soup, site)

        return {"price": price, "name": name, "site": site, "success": price is not None}
    except Exception as exc:
        return {"price": None, "name": "", "site": site, "success": False, "error": str(exc)}
