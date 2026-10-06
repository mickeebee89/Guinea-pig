# -*- coding: utf-8 -*-
"""Which files put a guard in a different statement from the action it guards?

A guard is a DO block containing `raise exception`. An action is a statement
that changes something: delete, update, drop, revoke, alter, truncate, or an
insert. If a guard statement is followed by action statements, the guard has
no force in an editor that does not run the paste as one unit.
"""
import io, os, re, sys

def split_statements(sql):
    """Split on top-level semicolons, respecting $tag$ ... $tag$ quoting."""
    out, buf, i, n = [], [], 0, len(sql)
    tag = None
    while i < n:
        if tag is None:
            m = re.match(r'\$[A-Za-z_]*\$', sql[i:])
            if m:
                tag = m.group(0); buf.append(tag); i += len(tag); continue
            if sql[i] == "'":
                j = i + 1
                while j < n:
                    if sql[j] == "'":
                        if j + 1 < n and sql[j+1] == "'":
                            j += 2; continue
                        break
                    j += 1
                buf.append(sql[i:j+1]); i = j + 1; continue
            if sql[i:i+2] == '--':
                j = sql.find('\n', i)
                j = n if j == -1 else j
                buf.append(sql[i:j]); i = j; continue
            if sql[i] == ';':
                out.append(''.join(buf)); buf = []; i += 1; continue
        else:
            if sql[i:i+len(tag)] == tag:
                buf.append(tag); i += len(tag); tag = None; continue
        buf.append(sql[i]); i += 1
    if ''.join(buf).strip():
        out.append(''.join(buf))
    return out


def strip_comments(s):
    return re.sub(r'--[^\n]*', '', s)


ACTION = re.compile(r'^\s*(delete\s+from|update\s+(?!.*\bset\b.*\bwhere\s+false)|drop\s+|revoke\s+|alter\s+table|truncate|insert\s+into)', re.I)

rows = []
for base, label in (('supabase', 'hand-run'), ('supabase/migrations', 'migration')):
    if not os.path.isdir(base):
        continue
    for fn in sorted(os.listdir(base)):
        if not fn.endswith('.sql'):
            continue
        p = os.path.join(base, fn).replace(os.sep, '/')
        if 'snapshot' in fn:
            continue
        try:
            sql = io.open(p, encoding='utf-8').read()
        except Exception:
            continue
        # only what is ABOVE the migration footer: verify blocks are comments
        cut = sql.find('-- MIGRATION FOOTER')
        if cut != -1:
            sql = sql[:cut]
        stmts = split_statements(sql)
        guard_at, actions_after = None, []
        for idx, raw in enumerate(stmts):
            s2 = strip_comments(raw).strip()
            if not s2:
                continue
            is_guard = s2.lower().startswith('do ') and 'raise exception' in s2.lower()
            if is_guard and guard_at is None:
                guard_at = idx
                continue
            if guard_at is not None and ACTION.match(s2):
                verb = re.match(r'^\s*(\w+)', s2).group(1).lower()
                actions_after.append(verb)
        if guard_at is not None and actions_after:
            rows.append((label, p, len(actions_after), ', '.join(sorted(set(actions_after)))))

print('%-10s %-62s %-6s %s' % ('kind', 'file', 'after', 'action verbs in separate statements'))
print('-' * 125)
for label, p, n, verbs in rows:
    print('%-10s %-62s %-6d %s' % (label, p, n, verbs))
print('\n%d file(s) put a guard in a different statement from the action it guards'
      % len(rows))
print('  hand-run : %d' % sum(1 for r in rows if r[0] == 'hand-run'))
print('  migration: %d' % sum(1 for r in rows if r[0] == 'migration'))
