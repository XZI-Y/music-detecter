plugins { id("com.android.application"); id("org.jetbrains.kotlin.android"); id("org.jetbrains.kotlin.plugin.compose"); id("org.jetbrains.kotlin.plugin.serialization") }
android {
 namespace = "io.github.xziy.radar"
 compileSdk = 35
 defaultConfig { applicationId = "io.github.xziy.radar"; minSdk = 26; targetSdk = 35; versionCode = 3; versionName = "1.0.2"; testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner" }
 buildFeatures { compose = true; buildConfig = false }
 compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
 kotlinOptions { jvmTarget = "17" }
 packaging { resources.excludes += "/META-INF/{AL2.0,LGPL2.1}" }
 buildTypes { release { isMinifyEnabled = true; isShrinkResources = true; proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"),"proguard-rules.pro"); ndk { abiFilters += listOf("arm64-v8a") } } }
}
dependencies {
 implementation(platform("androidx.compose:compose-bom:2024.12.01"))
 implementation("androidx.activity:activity-compose:1.10.1")
 implementation("androidx.compose.material3:material3")
 implementation("androidx.compose.material:material-icons-extended")
 implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.7")
 implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
 implementation("androidx.media3:media3-exoplayer:1.6.1")
 implementation("androidx.media3:media3-session:1.6.1")
 implementation("androidx.work:work-runtime-ktx:2.10.1")
 implementation("com.squareup.okhttp3:okhttp:4.12.0")
 implementation("org.bouncycastle:bcprov-jdk18on:1.78.1")
 implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")
 implementation("io.coil-kt:coil-compose:2.7.0")
 implementation("com.microsoft.onnxruntime:onnxruntime-android:1.23.2")
 implementation("com.google.zxing:core:3.5.3")
 testImplementation("junit:junit:4.13.2")
}
