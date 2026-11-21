plugins {
    kotlin("jvm")
    application
    id("io.spring.dependency-management")
}
dependencies {
    implementation(platform("org.springframework.boot:spring-boot-dependencies:3.5.16"))
    implementation(project(":packages:sim-core"))
    implementation(project(":modules:progression"))
    implementation(project(":modules:equipment"))
    implementation(project(":modules:inventory"))
    implementation(project(":modules:gems"))
    implementation(project(":modules:skills"))
    implementation(project(":modules:liveops"))
    implementation("com.fasterxml.jackson.core:jackson-databind")
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin")
    testImplementation(kotlin("test"))
}
sourceSets.main {
    resources.srcDir(rootProject.file("packages/game-content/versions"))
}

// The balance suite derives content by Monte Carlo simulation rather than guarding a
// regression, so it only changes answer when a balance formula or the game content moves.
// It costs about twelve minutes in CI, which is most of the jvm job, so it lives in its own
// source set and `check` never pulls it in. Run it with `./gradlew :apps:balance-lab:balanceTest`.
val balanceTest: SourceSet by sourceSets.creating {
    compileClasspath += sourceSets.main.get().output
    runtimeClasspath += sourceSets.main.get().output
}
configurations["balanceTestImplementation"].extendsFrom(configurations["testImplementation"])
configurations["balanceTestRuntimeOnly"].extendsFrom(configurations["testRuntimeOnly"])

// `test` gets friend-module access to `main` for free; a source set we make ourselves does
// not, and the suite reads internal declarations such as RaidBalance.loadReferenceBuild.
kotlin.target.compilations.named("balanceTest") {
    associateWith(kotlin.target.compilations.getByName("main"))
}

tasks.register<Test>("balanceTest") {
    group = "verification"
    description = "Runs the Monte Carlo balance derivations. Slow: about twelve minutes in CI."
    testClassesDirs = balanceTest.output.classesDirs
    classpath = balanceTest.runtimeClasspath
    shouldRunAfter(tasks.named("test"))
}
application { mainClass.set("com.hanjjak.balancelab.MainKt") }
tasks.named<JavaExec>("run") { workingDir(rootProject.projectDir) }
tasks.withType<Test>().configureEach { workingDir(rootProject.projectDir) }


tasks.register<JavaExec>("dungeonBalance") {
    group = "verification"
    description = "Derives and verifies candidate gem dungeon boss values."
    classpath = sourceSets.main.get().runtimeClasspath
    mainClass.set("com.hanjjak.balancelab.DungeonBalanceKt")
    workingDir(rootProject.projectDir)
}

tasks.register<JavaExec>("raidBalance") {
    group = "verification"
    description = "Derives and verifies daily seal raid boss and grade values."
    classpath = sourceSets.main.get().runtimeClasspath
    mainClass.set("com.hanjjak.balancelab.RaidBalanceKt")
    workingDir(rootProject.projectDir)
}

tasks.register<JavaExec>("dungeonLadder") {
    group = "verification"
    description = "Derives the gem dungeon reference build ladder from the progression timeline."
    classpath = sourceSets.main.get().runtimeClasspath
    mainClass.set("com.hanjjak.balancelab.DungeonLadderKt")
    workingDir(rootProject.projectDir)
}

tasks.register<JavaExec>("liveopsBalance") {
    group = "verification"
    description = "Projects event ticket supply, rice and cosmetic ticket outflow, and prize exhaustion."
    classpath = sourceSets.main.get().runtimeClasspath
    mainClass.set("com.hanjjak.balancelab.LiveopsBalanceKt")
    workingDir(rootProject.projectDir)
}
