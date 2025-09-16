import os
import sys

def print_directory_structure(root_path, file_handle, prefix=""):
    """将目录结构写入文件，并排除 __pycache__ 和 .pyc 文件"""
    try:
        # 过滤掉 __pycache__ 和 .pyc 文件
        items = sorted([item for item in os.listdir(root_path) if item != '__pycache__' and not item.endswith('.pyc')])
    except FileNotFoundError:
        file_handle.write(f"错误: 目录 '{root_path}' 不存在。\n")
        return

    for i, item in enumerate(items):
        item_path = os.path.join(root_path, item)
        is_last = i == len(items) - 1
        current_prefix = "└── " if is_last else "├── "
        
        if os.path.isdir(item_path):
            file_handle.write(f"{prefix}{current_prefix}{item}/\n")
            next_prefix = prefix + ("    " if is_last else "│   ")
            print_directory_structure(item_path, file_handle, next_prefix)
        else:
            try:
                size = os.path.getsize(item_path)
                file_handle.write(f"{prefix}{current_prefix}{item} ({size:,} bytes)\n")
            except OSError:
                file_handle.write(f"{prefix}{current_prefix}{item} (access error)\n")

def main():
    """主函数"""
    if len(sys.argv) != 2:
        print("用法: python list_structure.py <目标目录>")
        sys.exit(1)

    target_path = sys.argv[1]
    output_filename = os.path.basename(os.path.normpath(target_path)) + "_structure.txt"
    output_filepath = os.path.join(os.path.dirname(target_path), output_filename)


    if not os.path.isdir(target_path):
        print(f"错误: 目录 '{target_path}' 不存在。")
        sys.exit(1)

    with open(output_filepath, 'w', encoding='utf-8') as f:
        f.write(f"目录结构: {os.path.abspath(target_path)}\n")
        f.write("="*50 + "\n")
        print_directory_structure(target_path, f)
    
    print(f"目录结构已保存到: {output_filepath}")

if __name__ == "__main__":
    main()