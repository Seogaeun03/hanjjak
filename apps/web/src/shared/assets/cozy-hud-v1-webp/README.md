# Cozy HUD WebP runtime assets

PNG 편집 원본은 레포 밖 `2nd_PJT/HUD_PNG_ARCHIVE_20260918/cozy-hud-v1`에 보관한다. 이 폴더는 브라우저 런타임에서 사용하는 WebP 파생본만 보관한다.

- 기본 품질: 78
- 알파 품질: 100
- 디렉터리와 파일명은 원본 구조를 그대로 따른다.
- 원본 PNG를 수정하거나 새 런타임 참조를 추가한 뒤 `corepack pnpm --filter @hanjjak/web assets:hud:webp`를 실행한다. 다른 원본 경로를 사용할 때는 `HUD_PNG_SOURCE_ROOT`로 지정한다.
- 품질을 바꾸려면 PowerShell에서 `$env:HUD_WEBP_QUALITY=75`처럼 지정한 뒤 같은 명령을 다시 실행한다.

변환 도구는 현재 TypeScript·TSX·CSS가 참조하는 `cozy-hud-v1` 에셋만 생성한다. 미승인 후보와 사용하지 않는 작업 이미지는 자동으로 배포 대상에 포함하지 않는다.
