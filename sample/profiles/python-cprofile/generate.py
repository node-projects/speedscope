"""Recreate native cProfile fixtures with CPython 3.14.3; no third-party packages."""
import cProfile
import itertools
import json
import marshal
from pathlib import Path

def leaf():
    return sum((1, 2, 3))

def left():
    return leaf()

def right():
    return leaf()

def recursive(depth):
    return recursive(depth - 1) if depth else leaf()

def workload():
    left()
    right()
    recursive(3)

for function in (leaf, left, right, recursive, workload):
    function.__code__ = function.__code__.replace(co_filename='cprofile-fixture.py')

ticks = itertools.count()
profiler = cProfile.Profile(timer=lambda: next(ticks) / 1000)
profiler.runcall(workload)
directory = Path(__file__).parent
profiler.dump_stats(directory / 'native.prof')
for version in range(6):
    (directory / f'marshal-v{version}.prof').write_bytes(marshal.dumps(profiler.stats, version))
expected = [dict(file=key[0], line=key[1], name=key[2], primitive=value[0], calls=value[1],
                 self=value[2], cumulative=value[3], callers=[dict(file=caller[0],line=caller[1],name=caller[2],
                 calls=edge[0],primitive=edge[1],self=edge[2],cumulative=edge[3]) for caller,edge in value[4].items()])
            for key,value in profiler.stats.items()]
(directory / 'expected.json').write_text(json.dumps(expected, indent=2) + '\n', encoding='utf-8', newline='\n')
