import glob
import os
import sys

def strip_activity_sections(filepath: str) -> bool:
    """Reads a markdown file and removes any section starting with '## Activity' up to the next '## ' header or EOF."""
    if not os.path.exists(filepath):
        print(f"File not found: {filepath}")
        return False

    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    output_lines = []
    skipping = False

    for line in lines:
        if line.startswith('## '):
            header = line[3:].strip()
            if header.lower() == 'activity':
                skipping = True
                continue
            else:
                skipping = False

        if not skipping:
            output_lines.append(line)

    with open(filepath, 'w', encoding='utf-8') as f:
        f.writelines(output_lines)

    print(f"Successfully processed: {filepath}")
    return True

def main():
    if len(sys.argv) > 1:
        target_files = sys.argv[1:]
    else:
        target_files = glob.glob("codex-session-*.md")

    if not target_files:
        print("No matching codex-session-*.md files found.")
        return

    for file_path in target_files:
        for file_path in target_files:
            decision = input(f"Would you like to process: {file_path}? (Y/n): ")
            if not decision or decision.lower() == 'y':
                strip_activity_sections(file_path)

if __name__ == "__main__":
    main()
