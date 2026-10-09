#!/usr/bin/env python3
"""Check release integrity and retry behavior without publishing test artifacts."""

import hashlib
import importlib.util
import io
from pathlib import Path
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("attachment", ROOT / "tools/attach-release-zip.py")
attachment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(attachment)
DATA = (ROOT / "releases/v0.3.3/jp-letters-0.3.3.zip").read_bytes()
DIGEST = "42c1918a9e3d3ba3ddb364ad69b3f2370183a658cad5164cb4343b0398cf65b7"
ASSET = {"id": 123, "name": "jp-letters-0.3.3.zip", "size": len(DATA), "state": "uploaded"}


def release(assets=(), draft=False):
    return {"tag_name": "v0.3.3", "draft": draft, "assets": list(assets)}


class ReleaseAttachmentTests(unittest.TestCase):
    def test_actual_validated_zip_is_accepted(self):
        attachment.validate_archive(DATA, "v0.3.3", DIGEST)

    def test_wrong_expected_checksum_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "requested SHA-256"):
            attachment.validate_archive(DATA, "v0.3.3", "0" * 64)

    def test_changed_source_is_rejected_even_with_new_zip_checksum(self):
        changed = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(DATA)) as source, zipfile.ZipFile(changed, "w") as target:
            for name in source.namelist():
                value = source.read(name)
                if name.endswith("web/core.js"):
                    value += b"\n// changed after validation\n"
                target.writestr(name, value)
        data = changed.getvalue()
        with self.assertRaisesRegex(ValueError, "manifest"):
            attachment.validate_archive(data, "v0.3.3", hashlib.sha256(data).hexdigest())

    def test_missing_validation_manifest_is_rejected(self):
        changed = io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(DATA)) as source, zipfile.ZipFile(changed, "w") as target:
            for name in source.namelist():
                if not name.endswith("validation.json"):
                    target.writestr(name, source.read(name))
        data = changed.getvalue()
        with self.assertRaises(KeyError):
            attachment.validate_archive(data, "v0.3.3", hashlib.sha256(data).hexdigest())

    def test_already_attached_zip_is_verified_without_replacing_it(self):
        with patch.object(attachment, "api_json", return_value=release([ASSET])), \
                patch.object(attachment, "run_gh") as request, \
                patch.object(attachment, "download_asset", return_value=DATA) as download:
            self.assertFalse(attachment.ensure_attached("owner/repo", "v0.3.3", DIGEST, DATA))
            request.assert_not_called()
            download.assert_called_once()

    def test_existing_different_asset_is_never_overwritten(self):
        with patch.object(attachment, "api_json", return_value=release([ASSET])), \
                patch.object(attachment, "run_gh") as request, \
                patch.object(attachment, "download_asset", return_value=b"x" * len(DATA)):
            with self.assertRaisesRegex(ValueError, "not overwritten"):
                attachment.ensure_attached("owner/repo", "v0.3.3", DIGEST, DATA)
            request.assert_not_called()

    def test_new_attachment_is_downloaded_and_checked(self):
        def run(*arguments):
            self.assertEqual(arguments[:2], ("release", "upload"))
            self.assertEqual(Path(arguments[3]).read_bytes(), DATA)
            return b""
        with patch.object(attachment, "api_json", side_effect=[release(), release([ASSET])]), \
                patch.object(attachment, "run_gh", side_effect=run) as request, \
                patch.object(attachment, "download_asset", return_value=DATA) as download:
            self.assertTrue(attachment.ensure_attached("owner/repo", "v0.3.3", DIGEST, DATA))
            self.assertEqual(request.call_count, 1)
            download.assert_called_once()
            self.assertNotIn("--clobber", request.call_args_list[0].args)

    def test_draft_release_is_not_modified(self):
        with patch.object(attachment, "api_json", return_value=release(draft=True)), \
                patch.object(attachment, "run_gh") as request:
            with self.assertRaisesRegex(ValueError, "already published"):
                attachment.ensure_attached("owner/repo", "v0.3.3", DIGEST, DATA)
            request.assert_not_called()


if __name__ == "__main__":
    unittest.main()
