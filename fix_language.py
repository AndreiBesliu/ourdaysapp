import os
import re

files_to_update = [
    'src/components/EventDetailsModal.tsx',
    'src/components/GroupChatWidget.tsx',
    'src/components/GroupSettingsModal.tsx',
    'src/components/NotificationsDropdown.tsx',
    'src/components/RecurringEventsPanel.tsx'
]

for path in files_to_update:
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Add import { useThemeStore } from '../store';
    if 'useThemeStore' not in content:
        lines = content.split('\n')
        last_import = max((i for i, line in enumerate(lines) if line.startswith('import ')), default=-1)
        if last_import >= 0:
            lines.insert(last_import + 1, "import { useThemeStore } from '../store';")
            content = '\n'.join(lines)

    # Add const { language } = useThemeStore();
    # Find the component declaration: export const Component = ... or export default function Component...
    # Just look for the first '{' after 'export function' or 'export const'
    # Actually, a simpler regex to find the start of the component body
    # E.g. export const EventDetailsModal = ({ ... }) => {
    # Let's just find "=> {" or ") {" and insert it after.
    # It's safer to find "return (" and insert before it?
    # No, it should be at the top level of the component.
    # Let's find the first "const [", or similar hooks and insert before.
    
    # Let's look for "export const " or "export default function"
    match = re.search(r'(export\s+(?:const|default\s+function)\s+\w+[\s\S]*?(?:=>\s*{|\)\s*{))', content)
    if match:
        insert_pos = match.end()
        content = content[:insert_pos] + "\n  const { language } = useThemeStore();" + content[insert_pos:]

    with open(path, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f"Updated {path}")
