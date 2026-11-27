#!/usr/bin/env python3
"""Offline product hint from visible text in a photo (RapidOCR).

This is deliberately a *hint*, not a full visual classifier: it reads labels and
packaging text when present, then builds a compact Romanian shopping query.
Gemini Vision remains the preferred path when an API key is available.
"""

import json
import re
import sys
import unicodedata

sys.stdout.reconfigure(encoding="utf-8")


def normalize(text):
    text = unicodedata.normalize("NFD", str(text or "").lower())
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.replace(",", ".")
    text = re.sub(r"[^a-z0-9.]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def has_term(text, term):
    term = normalize(term)
    return bool(term) and re.search(r"(?:^|\s)" + re.escape(term) + r"(?:$|\s)", text) is not None


def read_ocr_lines(path):
    from PIL import Image, ImageFilter, ImageOps
    import numpy as np
    from rapidocr_onnxruntime import RapidOCR

    image = Image.open(path).convert("RGB")
    if image.width < 1200:
        image = image.resize(
            (image.width * 2, image.height * 2), Image.Resampling.LANCZOS
        )
        image = ImageOps.autocontrast(image)
        image = image.filter(ImageFilter.UnsharpMask(radius=2, percent=150, threshold=3))

    engine = RapidOCR()
    result, _ = engine(np.array(image))

    items = []
    for entry in result or []:
        if len(entry) < 2:
            continue
        box, text = entry[0], entry[1]
        text = str(text).strip()
        if not text:
            continue
        try:
            score = float(entry[2])
        except (TypeError, ValueError, IndexError):
            score = 0.0
        if score < 0.3:
            continue
        try:
            y = min(float(point[1]) for point in box)
        except (TypeError, ValueError, IndexError):
            y = 0.0
        items.append((y, text))
    items.sort(key=lambda item: item[0])
    return [text for _, text in items]


BRANDS = [
    ("the north face", "The North Face"),
    ("new balance", "New Balance"),
    ("under armour", "Under Armour"),
    ("la roche posay", "La Roche Posay"),
    ("optimum nutrition", "Optimum Nutrition"),
    ("the ordinary", "The Ordinary"),
    ("tommy hilfiger", "Tommy Hilfiger"),
    ("calvin klein", "Calvin Klein"),
    ("ralph lauren", "Ralph Lauren"),
    ("gym beam", "GymBeam"),
    ("my protein", "Myprotein"),
    ("bio tech usa", "BiotechUSA"),
    ("apple", "Apple"),
    ("samsung", "Samsung"),
    ("xiaomi", "Xiaomi"),
    ("huawei", "Huawei"),
    ("lenovo", "Lenovo"),
    ("asus", "Asus"),
    ("dell", "Dell"),
    ("sony", "Sony"),
    ("philips", "Philips"),
    ("bosch", "Bosch"),
    ("nike", "Nike"),
    ("adidas", "Adidas"),
    ("puma", "Puma"),
    ("reebok", "Reebok"),
    ("asics", "Asics"),
    ("salomon", "Salomon"),
    ("jordan", "Jordan"),
    ("converse", "Converse"),
    ("vans", "Vans"),
    ("fila", "Fila"),
    ("hoka", "Hoka"),
    ("skechers", "Skechers"),
    ("timberland", "Timberland"),
]


def find_brand(text):
    for term, label in BRANDS:
        if has_term(text, term):
            return label
    return ""


MODELS = [
    (r"air\s*max\s*plus\s*tn|air\s*max\s*tn|nike\s*tn|tuned\s*air|air\s*max\s*plus", lambda m: "Air Max Plus TN", "shoes"),
    (r"air\s*force\s*(?:1|one)|af\s*1|af1", lambda m: "Air Force 1", "shoes"),
    (r"air\s*max\s*97", lambda m: "Air Max 97", "shoes"),
    (r"air\s*max\s*95", lambda m: "Air Max 95", "shoes"),
    (r"air\s*max\s*90", lambda m: "Air Max 90", "shoes"),
    (r"air\s*max\s*270", lambda m: "Air Max 270", "shoes"),
    (r"air\s*max\s*1\b", lambda m: "Air Max 1", "shoes"),
    (r"gel\s*kayano\s*(\d+)?", lambda m: "GEL-KAYANO " + (m.group(1) or "").strip(), "shoes"),
    (r"ultra\s*boost", lambda m: "Ultraboost", "shoes"),
    (r"samba(?:\s*og)?", lambda m: "Samba OG", "shoes"),
    (r"dunk\s*low", lambda m: "Dunk Low", "shoes"),
    (r"yeezy\s*boost", lambda m: "Yeezy Boost", "shoes"),
    (r"jordan\s*(\d+)", lambda m: "Air Jordan " + m.group(1), "shoes"),
    (r"iphone\s*(\d+(?:\s*(?:pro\s*max|pro|plus|mini))?)", lambda m: "iPhone " + m.group(1).strip(), "electronics"),
    (r"galaxy\s*s\s*(\d+)", lambda m: "Galaxy S" + m.group(1), "electronics"),
    (r"macbook\s*(air|pro)?", lambda m: "MacBook " + (m.group(1) or "").strip(), "electronics"),
    (r"watch\s*series\s*(\d+)", lambda m: "Apple Watch Series " + m.group(1), "electronics"),
    (r"creatina\s*monohidrata", lambda m: "Creatina Monohidrata", "supplements"),
    (r"proteina\s*(?:din\s*zer|whey)?", lambda m: "Proteina Whey", "supplements"),
]


def find_model(text):
    for pattern, label_fn, category in MODELS:
        match = re.search(pattern, text)
        if match:
            label = re.sub(r"\s+", " ", label_fn(match)).strip()
            return label, category
    return "", ""


CATEGORY_KEYWORDS = {
    "shoes": ["pantofi", "adidasi", "sneakers", "tenisi", "incaltaminte", "ghete", "cizme", "air max", "air force"],
    "clothes": ["tricou", "hanorac", "geaca", "pantaloni", "blugi", "rochie", "jacheta", "hoodie"],
    "electronics": ["telefon", "laptop", "monitor", "televizor", "casti", "iphone", "samsung", "playstation", "xbox"],
    "supplements": ["proteina", "creatina", "supliment", "capsule", "pastile", "whey"],
    "pharmacy_beauty": ["crema", "serum", "sampon", "parfum", "ruj", "lotiune"],
    "diy_home": ["burghiu", "masina", "scule", "mobila", "aspirator"],
    "books": ["carte", "roman", "editura", "isbn"],
}


def detect_category(text, model_category):
    if model_category:
        return model_category
    for category, keywords in CATEGORY_KEYWORDS.items():
        if any(has_term(text, keyword) for keyword in keywords):
            return category
    return "general"


COLOR_GROUPS = {
    "black": ["triple black", "triplu negru", "black", "negru", "neagra", "negri", "negre"],
    "white": ["white", "alb", "alba", "albi", "albe"],
    "red": ["red", "rosu", "rosie", "rosii"],
    "blue": ["navy blue", "navy", "blue", "albastru", "albastra", "albastri", "albastre"],
    "grey": ["wolf grey", "dark grey", "grey", "gray", "gri"],
    "green": ["green", "verde", "verzi"],
    "yellow": ["yellow", "galben", "galbena", "galbeni", "galbene"],
    "brown": ["brown", "maro"],
    "beige": ["beige", "bej"],
    "pink": ["pink", "roz", "rozaliu"],
    "purple": ["purple", "violet", "mov"],
    "silver": ["silver", "argintiu", "argintie"],
    "gold": ["gold", "auriu", "aurie"],
    "orange": ["orange", "portocaliu", "portocalie"],
}


def detect_color(text):
    for color, terms in COLOR_GROUPS.items():
        if any(has_term(text, term) for term in terms):
            return color
    return ""


def find_size(text):
    for pattern in [
        r"(?:marimea|marime|size)\s*:?\s*(\d{2}(?:\.\d)?)",
        r"\b(\d{2}(?:\.\d)?)\s*eu\b",
    ]:
        match = re.search(pattern, text)
        if match:
            size = match.group(1).strip()
            try:
                if 35 <= float(size) <= 50:
                    return size
            except ValueError:
                pass
    return ""


def find_capacity(text):
    match = re.search(r"\b(\d+(?:\.\d+)?)\s*(gb|tb|kg|g|ml|l)\b", text)
    if not match:
        return ""
    value = match.group(1).rstrip(".")
    return value + match.group(2)


NOISE_WORDS = {
    "lei", "ron", "gratuit", "cumpara", "cumparare", "stoc", "disponibil",
    "disponibile", "moda", "frumusete", "site", "verifica", "pret", "total",
    "transport", "ramburs", "categorie", "ofarta", "oferte", "produs",
}


def fallback_query(lines, text):
    candidates = []
    for line in lines:
        norm = normalize(line)
        words = [w for w in norm.split() if w not in NOISE_WORDS and len(w) > 1]
        if len(words) >= 3:
            candidates.append(" ".join(words[:8]))
    if candidates:
        return max(candidates, key=len)
    return " ".join(text.split()[:8])


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "missing_image_path"}, ensure_ascii=False))
        return 1

    try:
        lines = read_ocr_lines(sys.argv[1])
    except Exception as exc:  # noqa: BLE001 - endpoint falls back to Gemini/manual
        print(json.dumps({"error": "ocr_failed", "detail": str(exc)}, ensure_ascii=False))
        return 1

    text = normalize(" ".join(lines))
    brand = find_brand(text)
    model, model_category = find_model(text)
    category = detect_category(text, model_category)
    color = detect_color(text)
    size = find_size(text)
    capacity = find_capacity(text) if category in {"electronics", "supplements"} else ""

    parts = [brand, model]
    if not model and category == "shoes":
        parts.append("sneakers")
    parts.extend([color, capacity])
    parts = [part for part in parts if part]

    confidence = 0.92 if brand and model else 0.62 if (brand or model) else 0.28
    if not parts:
        query = fallback_query(lines, text)
    else:
        query = " ".join(parts)

    print(
        json.dumps(
            {
                "query": query,
                "category": category,
                "size": size,
                "brand": brand,
                "model": model,
                "color": color,
                "confidence": confidence,
                "ocrLines": lines[:10],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
