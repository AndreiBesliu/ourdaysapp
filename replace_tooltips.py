import os
import re

dir_path = 'src'

replacements = [
    ('title="Show Code"', 'title={t(\'showCode\', language)}'),
    ('title="Edit Asset"', 'title={t(\'editAsset\', language)}'),
    ('title="Delete Asset"', 'title={t(\'deleteAsset\', language)}'),
    ('title="Recurring Events"', 'title={t(\'recurringEvents\', language)}'),
    ('title="Assets"', 'title={t(\'assetsTitle\', language)}'),
    ('title="Edit Series"', 'title={t(\'editSeries\', language)}'),
    ('title="Delete Series"', 'title={t(\'deleteSeries\', language)}'),
    ('title="Notifications"', 'title={t(\'notificationsTitle\', language)}'),
    ('title="Remove member"', 'title={t(\'removeMember\', language)}'),
    ('title="Ce s-a mai întâmplat? (AI Digest)"', 'title={t(\'aiDigestTooltip\', language)}'),
    ('title="Reply"', 'title={t(\'replyTooltip\', language)}'),
    ('title="Add reaction"', 'title={t(\'addReactionTooltip\', language)}'),
    ('title="Send voice message"', 'title={t(\'sendVoiceMessageTooltip\', language)}'),
    ('title="Record voice message"', 'title={t(\'recordVoiceMessageTooltip\', language)}'),
    ('title="How to play"', 'title={t(\'howToPlay\', language)}'),
    ('title="Cancel Game"', 'title={t(\'cancelGame\', language)}'),
    ('title="View Owner"', 'title={t(\'viewOwner\', language)}'),
    ('title="Edit Event"', 'title={t(\'edit\', language)}'),
    ('title="Close"', 'title={t(\'closeTooltip\', language)}'),
    ('title="Remove Asset"', 'title={t(\'removeAssetTooltip\', language)}'),
    ('title="Upload New Photo"', 'title={t(\'uploadNewPhoto\', language)}'),
    ('title="Pick from Assets"', 'title={t(\'pickFromAssets\', language)}'),
    ('title="Delete"', 'title={t(\'delete\', language)}'),
    ('title="Edit"', 'title={t(\'edit\', language)}'),
    ('title="Cancel"', 'title={t(\'cancel\', language)}')
]

for root, _, files in os.walk(dir_path):
    for file in files:
        if file.endswith('.tsx') or file.endswith('.ts'):
            path = os.path.join(root, file)
            with open(path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            new_content = content
            for old, new in replacements:
                # Basic string replacement
                new_content = new_content.replace(old, new)
                
            if new_content != content:
                # Add import if missing: import { t } from '../utils/i18n';
                if 't(' in new_content and 'import { t }' not in new_content and 'import { t,' not in new_content and 'import { getDateLocale, t }' not in new_content:
                    # Let's handle import dynamically. Usually it's import { t } from '../utils/i18n' or '../../utils/i18n'
                    depth = path.count(os.sep) - 1 # src is 1
                    prefix = '../' * depth if depth > 0 else './'
                    import_stmt = f"import {{ t }} from '{prefix}utils/i18n';\n"
                    # insert after last import
                    lines = new_content.split('\n')
                    last_import = max((i for i, line in enumerate(lines) if line.startswith('import ')), default=-1)
                    if last_import >= 0:
                        lines.insert(last_import + 1, import_stmt)
                        new_content = '\n'.join(lines)
                
                with open(path, 'w', encoding='utf-8') as f:
                    f.write(new_content)
                print(f"Updated {path}")
