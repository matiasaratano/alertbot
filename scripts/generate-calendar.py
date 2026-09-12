"""Genera calendario offline; no necesita Python durante el escaneo."""
import json
from pathlib import Path
import exchange_calendars as xcals

START, END = '2020-01-01', '2030-12-31'
calendar = xcals.get_calendar('XNYS', start=START, end=END)
sessions = {str(day.date()): [int(row['open'].timestamp()*1000), int(row['close'].timestamp()*1000)]
            for day, row in calendar.schedule.iterrows()}
output = {'source': 'exchange_calendars XNYS', 'version': xcals.__version__,
          'start': START, 'end': END, 'sessions': sessions}
Path(__file__).resolve().parents[1].joinpath('us-sessions.json').write_text(json.dumps(output, separators=(',', ':')) + '\n')
