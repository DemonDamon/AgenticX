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

# `desktop-runtime` extras 里声明的附件解析依赖大多是方法体内延迟导入。
# PyInstaller 的 modulegraph 常会漏掉，需显式 collect_all。
_DESKTOP_RUNTIME_PACKAGES = (
    "fitz",         # PyMuPDF 顶层模块名
    "pypdf",
    "docx",         # python-docx
    "pptx",         # python-pptx
    "numpy",
)

_CRITICAL_DESKTOP_RUNTIME_PACKAGES = (
    "numpy",
)

desktop_runtime_datas: list = []
desktop_runtime_binaries: list = []
desktop_runtime_hiddenimports: list = []
for _pkg in _DESKTOP_RUNTIME_PACKAGES:
    try:
        _d, _b, _h = collect_all(_pkg)
    except Exception as exc:
        # Critical runtime dependencies must never be skipped; otherwise the
        # shipped desktop bundle can boot but fail when attachment parsing is used.
        if _pkg in _CRITICAL_DESKTOP_RUNTIME_PACKAGES:
            raise RuntimeError(
                f"Missing critical desktop runtime dependency during PyInstaller collect_all: {_pkg}"
            ) from exc
        continue
    desktop_runtime_datas += _d
    desktop_runtime_binaries += _b
    desktop_runtime_hiddenimports += _h

hiddenimports = (
    agenticx_hiddenimports
    + litellm_hiddenimports
    + uvicorn_hiddenimports
    + desktop_runtime_hiddenimports
    + list(_CRITICAL_DESKTOP_RUNTIME_PACKAGES)
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
        # Customer Desktop delegates durable knowledge storage to Enterprise.
        # Never pull its local vector runtime into the bundled server.
        "chromadb",
        "onnxruntime",
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
