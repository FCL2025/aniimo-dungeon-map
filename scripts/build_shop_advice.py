"""Stage the audited shop price tiers used by the in-app purchase guide."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'exports/egg-shop-analysis-2026-10-12/evidence.json'


def stage_shop_advice(output):
    evidence = json.loads(SOURCE.read_text(encoding='utf-8'))
    boxes = evidence['items']['5200011']['purchases']
    recommendation = evidence['recommendation']
    tickets = evidence['items']['5200002']['purchases']
    assert len(boxes) == 30
    assert recommendation['boxLowPriceTierCount'] == 9
    assert boxes[8]['cumulativeCost'] == 4500000
    assert len(tickets) == 20
    assert evidence['assumptions']['revenuePerTicket'] == 300000
    assert recommendation['ticketFewestRunsForMaximumCashNet'] == 10
    assert recommendation['ticketMaximumDailyCashNet'] == tickets[9]['cumulativeNet'] == tickets[14]['cumulativeNet'] == 1760000
    assert recommendation['practicalLowerTimeOption'] == 6
    payload = {
        'tickets': [{k: row[k] for k in ('ordinal', 'price', 'cumulativeCost', 'cumulativeNet')} for row in tickets],
        'ticketRevenuePerRun': evidence['assumptions']['revenuePerTicket'],
        'boxes': [{k: row[k] for k in ('ordinal', 'price', 'cumulativeCost')} for row in boxes],
    }
    (output / 'shop-data.js').write_text('window.SHOP_ADVICE=' + json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + ';', encoding='utf-8')
