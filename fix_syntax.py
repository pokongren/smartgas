import re

with open('backend/app/services/assistant_tools.py', 'r', encoding='utf-8') as f:
    content = f.read()

# There are two `logger = logging.getLogger(__name__)` statements.
# The first one is at the top. The second one is before the real TOOL_DEFINITIONS.
parts = content.split('logger = logging.getLogger(__name__)')

if len(parts) >= 3:
    # Retain the top part and everything after the LAST logger declaration
    new_content = parts[0] + 'logger = logging.getLogger(__name__)\n' + parts[-1].lstrip()
    with open('backend/app/services/assistant_tools.py', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("Fixed syntax error by removing duplicate block.")
else:
    print("Could not find the expected duplication pattern.")

