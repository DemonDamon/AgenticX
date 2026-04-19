# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for Machi bundled Studio server (agx-server).

Author: Damon Li
"""

from PyInstaller.utils.hooks import collect_all, collect_data_files, collect_submodules

block_cipher = None

# Editable installs can confuse Analysis; collect_all pulls the full package tree.
agenticx_datas, agenticx_binaries, agenticx_hiddenimports = collect_all("agenticx")
litellm_hiddenimports = collect_submodules("litellm")

uvicorn_hiddenimports = [
    "uvicorn.lifespan.on",
    "uvicorn.lifespan.off",
    "uvicorn.lifespan",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.http.h11_impl",
    "uvicorn.protocols.http.httptools_impl",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.protocols.websockets.websockets_impl",
    "uvicorn.logging",
]

# `desktop-runtime` extras 里声明的第三方依赖在源码里几乎都是
# **方法体内 + try/except 包裹**的延迟导入（典型例子：
# `agenticx.studio.kb.runtime._ChromaBackend._ensure()` 里的
# `import chromadb`，以及 `pdf_reader.py` 里轮询 `fitz` / `pypdf` /
# `PyPDF2`）。PyInstaller 的 modulegraph 扫这种写法常常漏，必须显式
# `collect_all` 才能把 **数据 / 二进制 / 全部子模块** 一锅端进去；
# 否则即便 venv 里装好，运行时仍抛
# "chromadb is required for the knowledge base. Install with `pip install chromadb`."
_DESKTOP_RUNTIME_PACKAGES = (
    "chromadb",
    "onnxruntime",  # chromadb 默认 embedding 等路径动态依赖；否则运行时
                    # "The onnxruntime python package is not installed"
    "fitz",         # PyMuPDF 顶层模块名
    "pypdf",
    "docx",         # python-docx
    "pptx",         # python-pptx
    "docx2txt",
    "numpy",
)

desktop_runtime_datas: list = []
desktop_runtime_binaries: list = []
desktop_runtime_hiddenimports: list = []
for _pkg in _DESKTOP_RUNTIME_PACKAGES:
    try:
        _d, _b, _h = collect_all(_pkg)
    except Exception:
        # 单个 extras 包缺失（例如本地 dev 环境没装 PyMuPDF）不应该让
        # 整个打包流程失败；packaging/build_*.sh 已经强制安装
        # `[desktop-runtime]`，CI 中这里不会落入 except。
        continue
    desktop_runtime_datas += _d
    desktop_runtime_binaries += _b
    desktop_runtime_hiddenimports += _h

hiddenimports = (
    agenticx_hiddenimports
    + litellm_hiddenimports
    + uvicorn_hiddenimports
    + desktop_runtime_hiddenimports
    + ["tiktoken_ext.openai_public", "tiktoken_ext"]
)

datas = list(agenticx_datas) + desktop_runtime_datas
datas += collect_data_files("litellm", include_py_files=False)
try:
    datas += collect_data_files("tiktoken", include_py_files=False)
except Exception:
    pass

a = Analysis(
    ["agx_serve_entry.py"],
    pathex=[],
    binaries=list(agenticx_binaries) + desktop_runtime_binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # 大体积 ML / 可视化栈：桌面端 KB 不依赖
        "torch",
        "tensorflow",
        "easyocr",
        "matplotlib",
        "scipy",
        "sklearn",
        "pandas",
        "plotly",
        "seaborn",
        # NOTE: chromadb **不**排除——它是知识库默认向量后端，被
        # `agenticx.studio.kb.runtime._ChromaBackend` 直接 `import chromadb`，
        # 排除后桌面端打开「资料」页就抛 "chromadb is required..."。
        "qdrant_client",
        "pymilvus",
        "neo4j",
        "pytest",
        "black",
        "mypy",
        "flake8",
        "isort",
        "mkdocs",
        "mkdocstrings",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="agx-server",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
)
