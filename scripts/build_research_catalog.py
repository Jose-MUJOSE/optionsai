"""Build the offline research picker from public Nasdaq datasets.

Industry baskets include every matching common-equity row in the snapshot;
concept baskets are explicitly curated, never represented as exhaustive.
Run with --source-dir to rebuild from an archived snapshot without networking.
"""
import argparse
import csv
from datetime import datetime
import hashlib
import io
import json
from pathlib import Path
import re
import urllib.request
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
SOURCES = {
    "nasdaq-screener.json": "https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=10000&download=true",
    "nasdaqlisted.txt": "https://www.nasdaqtrader.com/dynamic/symdir/nasdaqlisted.txt",
    "otherlisted.txt": "https://www.nasdaqtrader.com/dynamic/symdir/otherlisted.txt",
}

# Exact Nasdaq industry labels, not guesses based on company names.
INDUSTRIES = [
    ("semiconductors", "半导体", "Semiconductors", "tech", ["Semiconductors"]),
    ("software", "软件与云服务", "Software & cloud", "tech", ["Computer Software: Prepackaged Software", "Computer Software: Programming Data Processing", "EDP Services"]),
    ("hardware", "计算机与电子硬件", "Computer hardware", "tech", ["Computer Manufacturing", "Computer peripheral equipment", "Electronic Components", "Computer Communications Equipment"]),
    ("banks", "银行", "Banks", "finance", ["Banks", "Commercial Banks", "Major Banks", "Savings Institutions"]),
    ("insurance", "保险", "Insurance", "finance", ["Accident &Health Insurance", "Life Insurance", "Property-Casualty Insurers", "Specialty Insurers"]),
    ("asset_managers", "券商与资产管理", "Brokers & asset managers", "finance", ["Investment Bankers/Brokers/Service", "Investment Managers"]),
    ("consumer_finance", "消费金融", "Consumer finance", "finance", ["Finance Companies", "Finance: Consumer Services", "Diversified Financial Services"]),
    ("biotech", "生物医疗", "Biotechnology", "health", ["Biotechnology: Biological Products (No Diagnostic Substances)", "Biotechnology: Commercial Physical & Biological Resarch", "Biotechnology: In Vitro & In Vivo Diagnostic Substances", "Pharmaceuticals and Biotechnology"]),
    ("pharma", "医药与制药", "Pharmaceuticals", "health", ["Biotechnology: Pharmaceutical Preparations", "Medicinal Chemicals and Botanical Products", "Other Pharmaceuticals"]),
    ("med_devices", "医疗器械与诊断", "Medical devices & diagnostics", "health", ["Medical/Dental Instruments", "Medical Electronics", "Medical Specialities", "Biotechnology: Electromedical & Electrotherapeutic Apparatus", "Biotechnology: Laboratory Analytical Instruments", "Ophthalmic Goods"]),
    ("health_services", "医疗服务", "Health services", "health", ["Hospital/Nursing Management", "Managed Health Care", "Medical/Nursing Services", "Misc Health and Biotechnology Services", "Retail-Drug Stores and Proprietary Stores"]),
    ("aerospace", "航空航天与国防", "Aerospace & defense", "industry", ["Aerospace", "Military/Government/Technical", "Ordnance And Accessories"]),
    ("industrials", "工业机械", "Industrial machinery", "industry", ["Industrial Machinery/Components", "Industrial Specialties", "Construction/Ag Equipment/Trucks", "Electrical Products", "Fluid Controls"]),
    ("logistics", "物流与运输", "Logistics & transport", "industry", ["Air Freight/Delivery Services", "Integrated Freight & Logistics", "Marine Transportation", "Railroads", "Transportation Services", "Trucking Freight/Courier Services"]),
    ("auto", "汽车与零部件", "Automotive", "industry", ["Auto Manufacturing", "Auto Parts:O.E.M.", "Motor Vehicles", "Automotive Aftermarket"]),
    ("energy", "石油与天然气", "Oil & gas", "energy", ["Integrated oil Companies", "Oil & Gas Production", "Oil Refining/Marketing", "Oil and Gas Field Machinery", "Oil/Gas Transmission", "Oilfield Services/Equipment"]),
    ("utilities", "电力与公用事业", "Utilities & power", "energy", ["Electric Utilities: Central", "Natural Gas Distribution", "Power Generation", "Water Supply"]),
    ("mining", "金属矿业", "Metals & mining", "energy", ["Metal Mining", "Other Metals and Minerals", "Precious Metals", "Steel/Iron Ore", "Aluminum", "Coal Mining"]),
    ("chemicals", "化工与材料", "Chemicals & materials", "energy", ["Major Chemicals", "Specialty Chemicals", "Agricultural Chemicals", "Plastic Products", "Paper", "Paints/Coatings"]),
    ("retail", "零售与电商", "Retail & e-commerce", "consumer", ["Catalog/Specialty Distribution", "Clothing/Shoe/Accessory Stores", "Department/Specialty Retail Stores", "Food Chains", "Other Specialty Stores", "RETAIL: Building Materials", "Retail-Auto Dealers and Gas Stations", "Retail: Computer Software & Peripheral Equipment"]),
    ("restaurants", "餐饮连锁", "Restaurants", "consumer", ["Restaurants"]),
    ("food", "食品饮料", "Food & beverages", "consumer", ["Beverages (Production/Distribution)", "Packaged Foods", "Specialty Foods", "Meat/Poultry/Fish", "Food Distributors"]),
    ("travel", "旅游酒店与休闲", "Travel & leisure", "consumer", ["Hotels/Resorts", "Services-Misc. Amusement & Recreation"]),
    ("media", "媒体娱乐与游戏", "Media & gaming", "consumer", ["Movies/Entertainment", "Broadcasting", "Cable & Other Pay Television Services", "Recreational Games/Products/Toys", "Publishing"]),
    ("apparel", "服装与日用消费", "Apparel & household", "consumer", ["Apparel", "Shoe Manufacturing", "Garments", "Package Goods/Cosmetics", "Home Furnishings"]),
    ("agriculture", "农业", "Agriculture", "consumer", ["Farming/Seeds/Milling", "Agricultural Chemicals"]),
    ("real_estate", "房地产与建筑", "Real estate & construction", "property", ["Real Estate", "Homebuilding", "Building operators", "Engineering & Construction"]),
    ("reits", "房地产信托 REITs", "REITs", "property", ["Real Estate Investment Trusts"]),
    ("telecom", "通信设备与服务", "Telecommunications", "property", ["Telecommunications Equipment", "Radio And Television Broadcasting And Communications Equipment"]),
]

# A concept can cross industry classifications. Membership is editorial and
# includes infrastructure/suppliers; source listing verification is separate.
THEMES = [
    ("commercial_space", "商业航天", "Commercial space", "industry", "发射、卫星、月球与地面服务", "Launch, satellite, lunar & ground services", "RKLB ASTS LUNR RDW PL BKSY SPIR SATL SPCE VSAT IRDM GSAT SATS SIDU FLY"),
    ("ai", "人工智能", "Artificial intelligence", "tech", "模型、软件与算力产业链", "AI software & compute ecosystem", "NVDA AMD AVGO MSFT GOOGL META AMZN ORCL PLTR AI BBAI SOUN PATH SNOW NOW CRWV NBIS TEM"),
    ("ai_infrastructure", "AI 算力与数据中心", "AI infrastructure", "tech", "服务器、光通信、散热与供电", "Servers, optics, cooling & power", "NVDA AMD AVGO MRVL ANET VRT SMCI DELL HPE EQIX DLR ETN MOD COHR LITE AAOI ALAB CRDO AXTI IREN CRWV NBIS"),
    ("cloud", "云计算与 SaaS", "Cloud & SaaS", "tech", "企业软件和云平台", "Enterprise software & cloud platforms", "MSFT AMZN GOOGL ORCL CRM NOW SNOW DDOG MDB NET TEAM WDAY ZM DOCU BILL GTLB MNDY HUBS SHOP"),
    ("cybersecurity", "网络安全", "Cybersecurity", "tech", "安全软件、网络与身份认证", "Network, endpoint & identity security", "PANW CRWD FTNT ZS OKTA S CYBR TENB RPD QLYS VRNS NET AKAM CHKP"),
    ("quantum", "量子计算", "Quantum computing", "tech", "量子硬件、软件及研发平台", "Quantum hardware, software & research", "IONQ RGTI QBTS QUBT IBM GOOGL MSFT HON"),
    ("robotics", "机器人与自动化", "Robotics & automation", "industry", "工业、医疗机器人及自动化设备", "Industrial & medical robotics, automation", "ISRG SYM TER ROK ABB IRBT SERV RR PATH TSLA NVDA AMBA ZBRA"),
    ("nuclear", "核能与铀矿", "Nuclear & uranium", "energy", "核电、先进反应堆和燃料", "Nuclear power, reactors & fuel", "CEG VST CCJ LEU UEC UUUU DNN NXE SMR OKLO NNE BWXT LTBR"),
    ("renewables", "新能源与储能", "Renewables & storage", "energy", "光伏、氢能、电池与储能", "Solar, hydrogen, batteries & storage", "FSLR ENPH SEDG RUN NXT ARRY BE PLUG BLDP FLNC EOSE GWH QS ENVX AMPX TSLA NEE"),
    ("ev", "新能源汽车", "Electric vehicles", "industry", "电车、充电与电池", "EVs, charging & batteries", "TSLA RIVN LCID NIO XPEV LI PSNY ZK CHPT EVGO BLNK QS ENVX"),
    ("fintech", "金融科技", "Fintech", "finance", "支付、互联网券商与数字金融", "Payments, online brokers & digital finance", "V MA PYPL XYZ FIS GPN SOFI AFRM UPST NU STNE PAGS HOOD COIN FUTU TIGR"),
    ("crypto", "数字资产相关", "Digital-asset ecosystem", "finance", "交易服务、矿业与持币企业", "Exchanges, miners & treasury companies", "COIN MSTR MARA RIOT CLSK IREN HUT CIFR WULF BTDR CORZ HOOD GLXY BMNR SBET"),
    ("weight_loss", "减重与代谢药物", "Obesity & metabolic drugs", "health", "已商业化产品和临床研发企业", "Commercial products & clinical developers", "LLY NVO AMGN VKTX GPCR ALT ZEAL HIMS PFE"),
]


def normalize(symbol):
    return symbol.strip().upper().replace('.', '-').replace('/', '-')


def build(source_dir, output):
    raw = {}
    for filename, url in SOURCES.items():
        path = source_dir / filename
        if not path.exists():
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json,text/plain"})
            with urllib.request.urlopen(req, timeout=45) as response:
                path.write_bytes(response.read())
        raw[filename] = path.read_bytes()
    listed = {}
    for filename in ["nasdaqlisted.txt", "otherlisted.txt"]:
        for row in csv.DictReader(io.StringIO(raw[filename].decode()), delimiter='|'):
            symbol = row.get('Symbol') or row.get('CQS Symbol')
            if symbol and row.get('Test Issue') == 'N' and row.get('ETF') == 'N':
                listed[normalize(symbol)] = row['Security Name']
    rows = json.loads(raw['nasdaq-screener.json'])['data']['rows']
    if len(rows) < 4000 or len(listed) < 4000:
        raise ValueError('Source unexpectedly incomplete; refusing to overwrite catalog')
    stocks = {}
    for row in rows:
        symbol = normalize(row['symbol'])
        name = row['name']
        # Exclude preferred shares, warrants, rights and SPAC units. Class
        # shares such as BRK-B remain supported by Yahoo's symbol format.
        if symbol not in listed or not re.fullmatch(r'[A-Z]{1,6}(?:-[A-Z])?', symbol):
            continue
        security_name = name + ' ' + listed[symbol]
        if re.search(r'preferred|preference|warrants?|\bunits?\b|\brights\b|\bnotes\b|\bdebentures\b|\bbonds\b', security_name, re.I):
            continue
        if row['industry'].strip() == 'Blank Checks':
            continue
        stocks[symbol] = {"symbol": symbol, "name": name, "industry": row['industry'].strip(),
                          "country": row['country'], "market_cap": float(row.get('marketCap') or 0)}
    baskets = []
    def add(key, zh, en, group, selected, kind, zh_desc, en_desc, rule):
        symbols = sorted(set(selected) & stocks.keys(), key=lambda s: (-stocks[s]['market_cap'], s))
        baskets.append(dict(id=key, zh=zh, en=en, group=group, kind=kind, description_zh=zh_desc,
                            description_en=en_desc, rule=rule, symbols=symbols))
    china_supplement = "BABA PDD JD NIO BIDU TME BILI TCOM XPEV LI NTES VIPS YMM ZTO EDU TAL FUTU TIGR BEKE BZ HTHT WB IQ QFIN FINV DQ JKS KC GDS TUYA DOYU HUYA MOMO YY YSG EH ATAT".split()
    add('china', '中概股', 'Chinese equities', 'region',
        [s for s, r in stocks.items() if r['country'] in {'China', 'Hong Kong'}] + china_supplement,
        'country', '数据源标注中国 / 香港的公司，补充常见中概股', 'China / Hong Kong in source, with a curated supplement',
        {'countries': ['China', 'Hong Kong'], 'supplement': china_supplement})
    for key, zh, en, group, industries in INDUSTRIES:
        # Nasdaq omits sector/industry fields on some slash-form class shares.
        # Keep the small, explicit supplement distinct from source classification.
        supplement = ['BRK-A', 'BRK-B'] if key == 'insurance' else []
        add(key, zh, en, group, [s for s, r in stocks.items() if r['industry'] in industries] + supplement,
            'industry', '纳斯达克行业分类 · 快照内全部匹配普通股' + ('；补充伯克希尔分股类别' if supplement else ''),
            'All matching common equities in the Nasdaq snapshot' + ('; Berkshire class-share supplement' if supplement else ''),
            {'industries': industries, 'supplement': supplement})
    removed = {}
    for key, zh, en, group, zh_desc, en_desc, symbols in THEMES:
        members = symbols.split()
        removed[key] = sorted(set(members) - stocks.keys())
        add(key, zh, en, group, members, 'theme', zh_desc, en_desc, {'curated': True})
    used = {s for basket in baskets for s in basket['symbols']}
    timestamp = datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds')
    artifact = dict(version=1, retrieved_at=timestamp, source_rows=len(rows), eligible_equities=len(stocks),
        sources=[{'url':url, 'sha256':hashlib.sha256(raw[filename]).hexdigest(),
                  'source_timestamp': raw[filename].decode().splitlines()[-1].split('|')[0] if filename.endswith('.txt') else None}
                 for filename,url in SOURCES.items()],
        categories=baskets, stocks={s:{k:v for k,v in stocks[s].items() if k != 'market_cap'} for s in sorted(used)})
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(artifact, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    receipt = {'retrieved_at':timestamp, 'categories':len(baskets), 'stocks':len(used), 'theme_symbols_not_in_snapshot':removed,
               'counts':{x['id']:len(x['symbols']) for x in baskets}}
    (source_dir/'receipt.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(receipt, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--source-dir', type=Path, default=ROOT / '.runtime' / 'sector-catalog')
    parser.add_argument('--output', type=Path, default=ROOT / 'frontend/src/data/research-catalog.json')
    args = parser.parse_args()
    args.source_dir.mkdir(parents=True, exist_ok=True)
    build(args.source_dir, args.output)
