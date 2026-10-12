"""Read local Aniimo shop data and calculate tiered purchase costs.

Game archives are only read. No game bytecode is executed.
"""
import csv
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import zipfile

from luajit_constants import constants
from pmdata import DEFAULT_ARCHIVE, MEMBER, PMData, PMTable, plain


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'exports' / 'egg-shop-analysis-2026-10-12'
REVENUE = 300_000
ITEMS = {3501001: 5200002, 3510001: 5200011}


def purchase_rows(commodity):
    """levelCost thresholds are inclusive 1-based purchase ordinals.

    ShopBuyComponent's price-rule display uses 1..first_threshold-1,
    previous_threshold..next_threshold-1, then last_threshold+.
    ShopBaseModel.getBuyPriceInfo also uses threshold-bought-1 for
    units remaining at the preceding price. See saved bytecode evidence.
    """
    stages = sorted((v[1], v[2]) for v in commodity['levelCost'].values())
    cumulative = 0
    result = []
    for ordinal in range(1, commodity['limitNum'] + 1):
        price = commodity['cost'][1][2]
        for threshold, tier_price in stages:
            if ordinal >= threshold:
                price = tier_price
        cumulative += price
        row = dict(ordinal=ordinal, price=price, cumulativeCost=cumulative)
        if commodity['itemId'] == 5200002:
            row.update(marginalNet=REVENUE-price,
                       cumulativeRevenue=REVENUE*ordinal,
                       cumulativeNet=REVENUE*ordinal-cumulative)
        result.append(row)
    return result


def scan_box_references(pm):
    """Scan relevant table families, preserving every reference path.

    A table may be shared at several paths. Cache relative results, rather
    than dropping subsequent paths to that table.
    """
    cache = {}

    def visit(value):
        if not isinstance(value, PMTable):
            return [((), 'value')] if value in (5200011, '5200011') else []
        if value.pos in cache:
            return cache[value.pos]
        result = []
        for key, child in value.items():
            if key == 5200011:
                result.append(((key,), 'key'))
            result.extend(((key,) + path, kind) for path, kind in visit(child))
        cache[value.pos] = result
        return result

    matches, families = [], []
    terms = ['item', 'drop', 'egg', 'shop', 'reward', 'chest', 'config',
             'constant', 'prob', 'random', 'guarantee', 'bonus']
    for name, table in pm.root.items():
        if name.startswith(('Scene.', 'SkillBPData.', 'Effect.')):
            continue
        if not any(term in name.lower() for term in terms):
            continue
        families.append(name)
        matches.extend(dict(path=(name,) + path, match=kind)
                       for path, kind in visit(table))
    return dict(tableFamilies=families, decodedTables=len(cache), matches=matches)


def main():
    pm = PMData()
    evidence = dict(
        checkedAt=datetime.now(timezone.utc).isoformat(),
        source=dict(archive=DEFAULT_ARCHIVE, member=MEMBER,
                    pmdataSha256=hashlib.sha256(pm.data).hexdigest()),
        assumptions=dict(
            revenuePerTicket=REVENUE,
            successfulRunsOnly=True,
            revenueBeforeTicketCost=True,
            otherExpensesIncluded=False,
            eggAndOtherNoncashRewardsValued=False,
            freeTicketsAndOtherIncomeIncluded=False,
            timeCostIncluded=False),
        thresholdSemantics='First purchase ordinal charged at the new price; inclusive.',
    )
    with zipfile.ZipFile(DEFAULT_ARCHIVE) as archive:
        index = json.loads(archive.read('xfs/luascripts/Data/I18N/NewTextMap_zh_TW.json'))
        blob = archive.read('xfs/luascripts/Data/I18N/Compress_zh_TW.bin')

        def localize(key):
            pointer = index.get(str(key))
            return (blob[pointer[0]:pointer[0]+pointer[1]].decode('utf-8')
                    if isinstance(pointer, list) else str(key))

        evidence['items'] = {}
        for commodity_id, item_id in ITEMS.items():
            item = pm.root['item_data'][item_id]
            commodity = pm.root['shop_commodity_data'][commodity_id]
            evidence['items'][item_id] = dict(
                name=localize(item['itemName']),
                description=localize(item['funcRep']),
                item=plain(item),
                effect=plain(pm.root['item_effect_data'].get(item_id)),
                commodityId=commodity_id,
                commodity=plain(commodity),
                purchases=purchase_rows(commodity),
            )

        evidence['bytecodeEvidence'] = {}
        selected = {
            'xfs/luascripts/Guis/Panels/Shop/Component/ShopBuyComponent.lua': [45],
            'xfs/luascripts/Guis/Panels/Shop/ShopBaseModel.lua': [26],
        }
        for member, indices in selected.items():
            raw = archive.read(member)
            _, prototypes = constants(raw)
            evidence['bytecodeEvidence'][member] = dict(
                sha256=hashlib.sha256(raw).hexdigest(),
                prototypes={})
            for i in indices:
                prototype = dict(prototypes[i])
                prototype['bytecode'] = prototype['bytecode'].hex()
                evidence['bytecodeEvidence'][member]['prototypes'][i] = prototype

        _, prototypes = constants(archive.read('xfs/luascripts/Common/Const/Const.lua'))
        evidence['limitTypeEnum'] = next(
            c for p in prototypes for c in p['constants']
            if isinstance(c, dict) and c == dict(DAY=1, WEEK=2, MONTH=3, NONE=0))
        _, prototypes = constants(archive.read('xfs/luascripts/Common/Const/ItemConst.lua'))
        evidence['chestUseType'] = next(
            c['USEITEM_TYPE_CHEST'] for p in prototypes for c in p['constants']
            if isinstance(c, dict) and 'USEITEM_TYPE_CHEST' in c)

    patches = Path(DEFAULT_ARCHIVE).parents[1] / 'patchv2' / 'lua' / 'ver'
    evidence['patches'] = []
    for patch in sorted(patches.glob('*/LuaScripts.xdf')):
        other = PMData(patch)
        evidence['patches'].append(dict(
            version=patch.parent.name,
            pmdataSha256=hashlib.sha256(other.data).hexdigest(),
            shopRows={key: plain(other.root['shop_commodity_data'][key]) for key in ITEMS}))

    packages = pm.root['drop_package_data']
    subtables = [sub for package in packages.values() for sub in package.values()]
    evidence['probabilityAudit'] = dict(
        boxReferences=scan_box_references(pm),
        packageCount=len(packages), subtableCount=len(subtables),
        nonemptySubtables=sum(bool(sub) for sub in subtables),
        confirmed='Item description says one random egg, with possible Umbral and Prismana eggs.',
        unresolved='No usable box reward link, numeric odds, or pity rule found in the inspected client data. '
                   'Do not interpret missing client configuration as proof that server-side pity is absent.',
        officialProbabilityPage='https://www.aniimo.com/zh-tw/formula-multipliers',
        officialPageFinding='No Mystery Egg Box opening odds listed on the page checked on 2026-10-12.',
    )
    tickets = evidence['items'][5200002]['purchases']
    boxes = evidence['items'][5200011]['purchases']
    max_net = max(row['cumulativeNet'] for row in tickets)
    evidence['recommendation'] = dict(
        boxLowPriceTierCount=9, boxLowPriceTierCost=boxes[8]['cumulativeCost'],
        boxRecommendationCondition='Price-tier budget recommendation assuming same reward distribution '
                                   'for the identical item; not a proven expected-value optimum.',
        ticketFewestRunsForMaximumCashNet=next(row['ordinal'] for row in tickets
                                              if row['cumulativeNet'] == max_net),
        ticketMaximumDailyCashNet=max_net,
        ticketMaximumNetPlateau=[row['ordinal'] for row in tickets if row['cumulativeNet'] == max_net],
        practicalLowerTimeOption=6,
        weeklyScenarios=[dict(ticketsPerDay=n,
                              weeklyTicketCost=tickets[n-1]['cumulativeCost']*7,
                              weeklyNetBeforeBoxes=tickets[n-1]['cumulativeNet']*7,
                              weeklyNetAfterNineBoxes=tickets[n-1]['cumulativeNet']*7-boxes[8]['cumulativeCost'])
                         for n in (3, 6, 10)],
    )

    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / 'evidence.json').write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8')
    with (OUTPUT / 'purchase-costs.csv').open('w', newline='', encoding='utf-8-sig') as handle:
        writer = csv.writer(handle)
        writer.writerow(['商品', '重置週期', '第幾件', '單價蛋殼幣', '累計成本',
                         '單場扣船票淨收入', '累計扣船票淨收入'])
        for item_id, info in evidence['items'].items():
            for row in info['purchases']:
                writer.writerow([info['name'], '每日' if item_id == 5200002 else '每週',
                                 row['ordinal'], row['price'], row['cumulativeCost'],
                                 row.get('marginalNet', ''), row.get('cumulativeNet', '')])
    print(json.dumps(evidence['recommendation'], ensure_ascii=False, indent=2))
    print(OUTPUT)


if __name__ == '__main__':
    main()
