# 로컬 가속 베타 테스트

보석 던전 가속 베타 프로파일을 로컬에서 돌리고, 1~10단계를 전부 클리어할 수 있는 테스트 계정을 만드는 절차다. 프로파일 값과 보스 수치는 [가속 베타 프로파일](../../docs/60-content/gems/beta-accelerated.md)이 소유한다.

## 준비물

- Docker (PostgreSQL 17.6 컨테이너용). 로컬에 PostgreSQL이 이미 있으면 그걸 써도 된다.
- JDK 21, Node 24 이상, pnpm 10.

## 빠른 실행 (Windows)

이 폴더의 배치 파일을 더블클릭하면 된다.

| 파일 | 하는 일 |
|---|---|
| `run-beta.bat` | PostgreSQL 기동 → API(베타 프로파일)와 웹을 각각 새 창에서 실행 |
| `seed-tester.bat` | 회원가입한 계정을 테스트 빌드로 끌어올림 (이메일을 물어본다) |
| `run-api-beta.bat` | API만 베타 프로파일로 실행 |
| `run-web.bat` | 웹 클라이언트만 실행 |

`run-beta.bat` → 웹에서 회원가입 → `seed-tester.bat` 순서면 끝난다. 아래는 각 단계를 수동으로 할 때의 설명이다.

## 어드민 콘솔 로컬 고정 로그인

치장 관리 화면처럼 관리자 콘솔을 직접 검증할 때만 사용한다. 이 로그인은 운영용 GitLab OAuth와 별개이며 `local` Spring 프로파일 + `ADMIN_LOCAL_LOGIN_ENABLED=true` + `ADMIN_GITLAB_OAUTH_ENABLED=false`일 때 로컬(loopback) 요청에만 제공된다. 고정 ID와 비밀번호는 저장소에 기본값이 없다. 아래 값은 **실행 중인 PowerShell 프로세스에서만** 설정하고, 자신만 아는 32바이트 이상의 긴 비밀번호로 바꿔 사용한다. 이 설정을 운영 서버/공유 개발 서버에 복사하지 않는다.

```powershell
cd C:\project\hanjjak-cosmetic-curation
docker compose -f infra/local/compose.yaml up -d
$env:ADMIN_LOCAL_LOGIN_ENABLED = "true"
$env:ADMIN_GITLAB_OAUTH_ENABLED = "false"
$env:ADMIN_LOCAL_USERNAME = "local-admin"
$env:ADMIN_LOCAL_PASSWORD = "<UTF-8 기준 32바이트 이상인 로컬 전용 비밀번호>"
$env:ADMIN_ALLOWED_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174"
.\gradlew.bat :apps:game-api:bootRun --args="--spring.profiles.active=local"
```

서버가 준비되면 다른 터미널에서 루트 기준 `corepack pnpm install`, `corepack pnpm --filter @hanjjak/web dev`, `corepack pnpm --filter @hanjjak/admin-console dev`를 각각 실행한다. 기본 접속 주소는 `http://localhost:5173/admin/`이며 게임 웹 개발 서버가 관리자 화면으로 프록시한다. 입력한 ID·비밀번호로 로그인하면 치장 세트 갤러리에서 기존 아트 검사·그룹 ZIP·세트 추가·제작 진행·중단·검수를 확인할 수 있다. 서버 연결이 없거나 설정이 꺼져 있으면 고정 로그인 폼은 보이지 않는다. 어드민만 `5174`에서 직접 여는 경우에도 API에 위 `ADMIN_ALLOWED_ORIGINS`가 적용돼야 변경 요청을 받을 수 있다. 테스트가 끝나면 서버를 내리고 현재 PowerShell의 `ADMIN_LOCAL_LOGIN_ENABLED`, `ADMIN_LOCAL_USERNAME`, `ADMIN_LOCAL_PASSWORD`, `ADMIN_ALLOWED_ORIGINS` 환경변수를 제거한다. 로컬 검증 데이터는 운영 DB가 아닌 로컬 PostgreSQL에만 저장한다.

```powershell
"ADMIN_LOCAL_LOGIN_ENABLED", "ADMIN_LOCAL_USERNAME", "ADMIN_LOCAL_PASSWORD", "ADMIN_ALLOWED_ORIGINS" | ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }
```

기존 로컬 DB의 적용 migration이 현재 저장소에서 해결되지 않으면 DB를 초기화하거나 적용 migration을 바꾸지 않는다. 별도 테스트 DB를 만들고 `DB_URL`을 지정한다. 치장 갤러리 검증은 `hanjjak_cosmetic_demo`를 사용한다. 제작 중 다른 메뉴로 이동하거나 새로고침한 뒤 갤러리의 제작 작업에서 계속 진행되는지 확인하고, 중단 시 이미 생성된 프레임이 남는지 확인한다. 제작·검수 데이터는 서버 DB에 남으므로 브라우저 데이터 삭제로 초기화되지 않는다.


## 1. PostgreSQL 기동

```
docker compose -f infra/local/compose.yaml up -d
```

`localhost:5432`에 `hanjjak` DB, 계정 `hanjjak` / `local-only`로 뜬다. `application.yml`의 기본값과 같아서 추가 환경변수가 필요 없다.

이미 PC의 PostgreSQL이 5432를 사용 중이면 다음처럼 Docker 포트만 바꿀 수 있다.

```powershell
$env:LOCAL_POSTGRES_PORT = "5433"
docker compose -f infra/local/compose.yaml up -d
$env:DB_URL = "jdbc:postgresql://127.0.0.1:5433/hanjjak"
```

## 2. API를 베타 프로파일로 기동

Windows PowerShell:

```
.\gradlew.bat :apps:game-api:bootRun --args="--spring.profiles.active=beta"
```

macOS / Linux:

```
./gradlew :apps:game-api:bootRun --args='--spring.profiles.active=beta'
```

Flyway가 `V52__gem_ticket_stock_policy.sql`까지 적용한다. 기동 로그에 `The following 1 profile is active: "beta"`가 보이면 승격 전 `gem-dungeon-beta-v1-accelerated` 식별자를 사용하는 검증 모드다. 프로파일 없이 띄우면 동일한 1시간·최대 5장 정책과 수치를 신규 정식 `gem-dungeon-v2-accelerated-applied` 식별자로 실행한다.

포트는 기본 8080이다.

## 3. 웹 클라이언트 기동

```
pnpm install
pnpm --filter @hanjjak/web dev
```

`http://localhost:5173`에서 열리고, `/api`는 Vite가 `127.0.0.1:8080`으로 프록시한다.

## 4. 회원가입

웹에서 평범하게 회원가입한다. 비밀번호 해시와 세션은 서버가 만들게 두는 편이 안전해서, 시드 스크립트는 계정을 새로 만들지 않고 **이미 있는 계정을 끌어올리기만** 한다.

## 5. 테스트 계정 시드

```
set PGPASSWORD=local-only
psql -h localhost -U hanjjak -d hanjjak -v email=you@example.com -f tools/local/seed-beta-tester.sql
```

psql이 없으면 컨테이너 안에서 실행한다. 이쪽은 소켓 접속이라 비밀번호가 필요 없다.

```
docker compose -f infra/local/compose.yaml exec -T postgres \
  psql -U hanjjak -d hanjjak -v email=you@example.com < tools/local/seed-beta-tester.sql
```

끝나면 닉네임·레벨·장비 슬롯 수·스킬 수·5레벨 보석 수·입장권이 한 줄로 출력된다. 여러 번 실행해도 안전하다.

시드 후에는 웹을 새로고침한다. 캐릭터 상태는 `state_version`으로 캐시되는데 스크립트가 이 값을 올린다.

### 11~15장·특수 옵션 보석 프리뷰

후반 챕터 연출과 특수 옵션의 실제 스탯 반영을 함께 확인할 때는 별도 프리뷰 시드를 사용한다.

```
set PGPASSWORD=local-only
psql -h localhost -U hanjjak -d hanjjak -v email=you@example.com -f tools/local/seed-late-chapter-preview.sql
```

컨테이너 안에서 실행할 때는 다음과 같다.

```
docker compose -f infra/local/compose.yaml exec -T postgres \
  psql -U hanjjak -d hanjjak -v email=you@example.com < tools/local/seed-late-chapter-preview.sql
```

이 시드는 1~15장을 모두 선택 가능하게 하고, 1~14장은 클리어 상태로 맞춘다. 메인 보석 프리셋에는 7레벨 공격력 15% 두 개, 방어 관통 120 두 개, 치명타 확률 12%p 한 개, 공격속도 12% 한 개를 잠금 상태로 장착한다. 따라서 스탯 상세에서 공격력 30%와 방어 관통 240의 동일 옵션 합산도 함께 확인할 수 있다. 기존 베타 시드와 마찬가지로 로컬 전용이며 여러 번 실행해도 같은 보석을 갱신한다.

## 시드가 넣는 것

| 항목 | 값 | 근거 |
|---|---|---|
| 레벨 | 60 (경험치도 함께 맞춤) | 10단계 기준 빌드가 53레벨 |
| 장비 | 6슬롯 전부 EPIC +30 → 슬롯당 Q 108 | 10단계 기준 Q 98 |
| 스킬 | 6종 전부 EPIC 10 | MVP 최고 등급. 10단계 기준은 R2 |
| 보석 | 5레벨 30개 (고정 공격력 70 × 18, 고정 최대 HP 700 × 12) | 요청대로 전부 5레벨 |
| 프리셋 | 폭주형·장갑형 = 공격 6개, 생존형 = HP 6개, 메인 = 3+3 | 보스별 검사축에 맞춤 |
| 스테이지 | 1-1~3-10 클리어, 4챕터 해금 | 1-5 클리어가 보석 해금 조건 |
| 입장권 | 5장 | 베타 상한 |
| 테스트 보스 선택 | 활성화 | 1시간 로테이션을 기다리지 않고 세 보스를 바로 고를 수 있다 |

1~5레벨 보석은 옵션 풀에 고정 공격력과 고정 최대 HP만 있어서, 5레벨 보석에는 공격력%·방어 관통·치명타·공격속도가 붙지 않는다. 장갑형 방어 관통은 전부 장비에서 나온다.

보석 16~18번과 28~30번은 일부러 장착하지 않고 남겨 둔다. 인벤토리·잠금·합성 화면을 바로 확인할 수 있다.

## 검증 결과

이 시드 상태를 서버가 실제로 쓰는 `DungeonCombatSimulator` 기준으로 돌린 결과다.

| 프리셋 | 공격력 | 최대 HP | 방어 관통 | 1~10단계 |
|---|---:|---:|---:|---|
| 생존형 | 994 | 14,143 | 668 | 전부 클리어 |
| 폭주형 | 1,414 | 9,943 | 668 | 전부 클리어 |
| 장갑형 | 1,414 | 9,943 | 668 | 전부 클리어 |

- 생존형 10단계는 15초 종료 시 HP 5,960이 남는다.
- 폭주형 10단계는 최악 seed에서 4.8초, 장갑형 10단계는 3.8초에 처치한다. 제한시간 15초 대비 여유가 크다.
- 같은 계정으로 정식 서비스 콘텐츠(`gem-dungeons.json`)를 돌리면 폭주형 5단계, 생존형·장갑형 4단계에서 막힌다. 가속 베타 콘텐츠가 실제로 적용됐는지 이걸로 구분할 수 있다.

난이도를 체감하고 싶으면 장비 등급을 `RARE`로 낮추거나(`equipment_slot_state`의 `grade`) 스킬 레벨을 내리면 된다.

## 확인해 볼 것

- 던전 화면의 보스가 KST 정각마다 생존형 → 폭주형 → 장갑형으로 바뀐다.
- 입장권이 1시간마다 한 장 차고 5장에서 멈춘다. 5장에서 한 장 쓰면 그 시점부터 다시 1시간을 센다.
- 5장을 다 쓰고 연속으로 신규 단계에 도전할 수 있다.
- 도전 중 정각을 넘겨도 시작 시점 보스·단계로 끝까지 처리된다.
- 최초 클리어 보상은 단계당 `9 + 단계` 개, 소탕은 그 30%를 내린 값이다.

## 베타 검증 식별자 끄기

`--args` 없이 `bootRun`하면 신규 정식 v2 콘텐츠로 실행한다. 이전 정식 v1을 재현하려면 콘텐츠 리소스·순환·입장권 환경변수를 v1 값으로 명시한다.
