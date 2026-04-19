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

hiddenimports = (
    agenticx_hiddenimports
    + litellm_hiddenimports
    + uvicorn_hiddenimports
    + ["tiktoken_ext.openai_public", "tiktoken_ext"]
)

datas = list(agenticx_datas)
datas += collect_data_files("litellm", include_py_files=False)
try:
    datas += collect_data_files("tiktoken", include_py_files=False)
except Exception:
    pass

a = Analysis(
    ["agx_serve_entry.py"],
    pathex=[],
    binaries=list(agenticx_binaries),
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
