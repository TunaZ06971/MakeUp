import unittest
from audit_public import inspect

class PublicAuditTests(unittest.TestCase):
    def test_private_paths(self):
        for path in ['.env.production', 'web/.env.local', '.firebase/accounts.json', '.artifacts/preview.svg', 'scan.makeupcapture', 'person.glb', 'face.jpg', 'Face.JPG', 'screen.PNG', 'portrait.webp', 'clip.MOV', 'apple/project.local.yml', 'HANDOVER.md']:
            self.assertIn('private-path', inspect(path, b'placeholder'), path)

    def test_examples_and_canonical_geometry_are_publishable(self):
        for path in ['web/.env.example', 'apple/project.local.example.yml', 'scripts/canonical/canonical_face_model.obj', 'web/public/favicon.svg', 'LICENSE']:
            self.assertEqual(inspect(path, b'public example'), [], path)

    def test_content_is_checked_even_under_a_safe_filename(self):
        self.assertIn('private-key', inspect('notes.md', b'-----BEGIN ' + b'PRIVATE KEY-----'))
        self.assertIn('personal-absolute-path', inspect('notes.md', b'/Users/' + b'someone/Desktop/image.jpg'))
        self.assertIn('embedded-private-media', inspect('notes.md', b'data:image/jpeg;base64,' + b'A' * 110))
        self.assertIn('unreviewed-binary', inspect('payload.txt', b'hello\0world'))

    def test_demo_credentials_are_not_real_secrets(self):
        self.assertEqual(inspect('web/src/lib/firebase.ts', b'apiKey: "demo-api-key"'), [])

if __name__ == '__main__':
    unittest.main()
