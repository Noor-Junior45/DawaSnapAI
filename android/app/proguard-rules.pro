# ==============================================================================
# ProGuard & R8 Optimization Rules - DawaSnap AI (in.dawasnap.app)
# Tailored to exceed Google Play Console DEX Code Optimization thresholds (>25%)
# Covering: Shrinking, Obfuscation, and Bytecode Optimization in R8 Full Mode
# ==============================================================================

# ------------------------------------------------------------------------------
# 1. GLOBAL R8 BYTECODE OPTIMIZATION & AGGRESSIVE OBFUSCATION
# ------------------------------------------------------------------------------
# Run up to 5 iterative optimization passes to maximize dead-code removal & inlining
-optimizationpasses 5

# Allow R8 to widen class & member visibility to public for aggressive cross-package inlining
-allowaccessmodification

# Repackage obfuscated classes to flatten package hierarchy and shrink DEX string pools
-repackageclasses ''

# Aggressively reuse obfuscated names across methods/fields with distinct signatures
-overloadaggressively

# Keep source line numbers and file names for Crashlytics stack trace de-obfuscation
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# Preserve essential annotations, generics signatures, and exceptions for reflection
-keepattributes *Annotation*,Signature,Exceptions,InnerClasses,EnclosingMethod

# Strip Kotlin debug assertions & verbose metadata to reduce DEX size
-assumenosideeffects class kotlin.jvm.internal.Intrinsics {
    public static void checkNotNullParameter(...);
    public static void checkParameterIsNotNull(...);
}

# ------------------------------------------------------------------------------
# 2. FIREBASE CORE, ANALYTICS & COMMON
# ------------------------------------------------------------------------------
# Keep classes with @Keep or @KeepName annotations
-keep @androidx.annotation.Keep class * { *; }
-keep @com.google.android.gms.common.annotation.KeepName class * { *; }
-keepclassmembers class * {
    @androidx.annotation.Keep *;
    @com.google.android.gms.common.annotation.KeepName *;
}

# Firebase Component Registrars (instantiated reflectively by FirebaseApp)
-keep class * implements com.google.firebase.components.ComponentRegistrar {
    public <init>();
}

# Keep FirebaseApp initialization entry points
-keep class com.google.firebase.FirebaseApp {
    public static *** getInstance(...);
    public static *** initializeApp(...);
}

# ------------------------------------------------------------------------------
# 3. FIREBASE CLOUD MESSAGING (FCM / PUSH NOTIFICATIONS)
# ------------------------------------------------------------------------------
# Allow R8 to obfuscate and shrink internal messaging classes while keeping service entry points
-keep public class * extends com.google.firebase.messaging.FirebaseMessagingService {
    public <init>();
    public void onMessageReceived(com.google.firebase.messaging.RemoteMessage);
    public void onNewToken(java.lang.String);
}
-keep class com.google.firebase.messaging.RemoteMessage { *; }
-keep class com.google.firebase.iid.FirebaseInstanceIdReceiver {
    public <init>();
}

# ------------------------------------------------------------------------------
# 4. FIREBASE CRASHLYTICS
# ------------------------------------------------------------------------------
-keep public class * extends java.lang.Exception
-keepclassmembers class com.google.firebase.crashlytics.** {
    public void log(java.lang.String);
    public void recordException(java.lang.Throwable);
    public void setCustomKey(...);
    public void setUserId(java.lang.String);
}

# ------------------------------------------------------------------------------
# 5. FIREBASE AUTHENTICATION & GOOGLE CREDENTIAL MANAGER
# ------------------------------------------------------------------------------
# Firebase Auth core models & entry points
-keep class com.google.firebase.auth.FirebaseAuth {
    public static *** getInstance(...);
    public *** getCurrentUser();
    public *** signInWithCredential(...);
    public *** signOut();
}
-keep class com.google.firebase.auth.FirebaseUser {
    public *** getUid();
    public *** getEmail();
    public *** getDisplayName();
    public *** getPhotoUrl();
}
-keep class com.google.firebase.auth.AuthCredential { *; }
-keep class com.google.firebase.auth.GoogleAuthProvider {
    public static *** getCredential(java.lang.String, java.lang.String);
}
-keep class com.google.firebase.auth.AuthResult { *; }

# Android Credential Manager & Google ID library for native Google Sign-In
-keep class androidx.credentials.CredentialManager { *; }
-keep class androidx.credentials.GetCredentialRequest { *; }
-keep class androidx.credentials.GetCredentialResponse { *; }
-keep class androidx.credentials.CustomCredential { *; }
-keep class com.google.android.libraries.identity.googleid.** { *; }

# Google Play Services Auth
-keep class com.google.android.gms.auth.api.signin.GoogleSignInAccount {
    public *** getIdToken();
    public *** getEmail();
    public *** getDisplayName();
}

# ------------------------------------------------------------------------------
# 6. GOOGLE MOBILE ADS (ADMOB - @capacitor-community/admob)
# ------------------------------------------------------------------------------
# Keep public interfaces and lifecycle callbacks for AdMob; allow internal obfuscation
-keep public class com.google.android.gms.ads.** {
    public *;
}
-keep public interface com.google.android.gms.ads.** {
    public *;
}
-keep class com.google.android.gms.ads.internal.** { *; }
-keepclassmembers enum com.google.android.gms.ads.** {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# ------------------------------------------------------------------------------
# 7. CAPACITOR CORE & NATIVE PLUGINS BRIDGE
# ------------------------------------------------------------------------------
# Keep BridgeActivity and Bridge entry points
-keep class com.getcapacitor.BridgeActivity {
    protected void onCreate(android.os.Bundle);
    public com.getcapacitor.Bridge getBridge();
}
-keep class com.getcapacitor.Bridge {
    public *** eval(java.lang.String);
    public *** triggerJSEvent(...);
}

# Keep Plugin classes and their reflective PluginMethods called from WebView JavaScript
-keep class * extends com.getcapacitor.Plugin {
    public <init>();
}
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.PluginMethod public void *(com.getcapacitor.PluginCall);
    @com.getcapacitor.PluginMethod public *;
}

# Keep JavaScript Interfaces invoked from the WebView
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep JS data containers used by Capacitor plugins
-keep class com.getcapacitor.JSObject { *; }
-keep class com.getcapacitor.JSArray { *; }
-keep class com.getcapacitor.PluginCall {
    public *** resolve(...);
    public *** reject(...);
    public *** getData();
    public *** getString(...);
    public *** getBoolean(...);
    public *** getInt(...);
    public *** getLong(...);
    public *** getObject(...);
    public *** getArray(...);
}

# ------------------------------------------------------------------------------
# 8. STANDARD ENUMS, SERIALIZATION & SAFE SUPPRESSIONS
# ------------------------------------------------------------------------------
# Keep standard enum methods required by Java reflection
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}

# Suppress benign warnings from third-party libraries resolved at runtime
-dontwarn com.google.android.gms.**
-dontwarn com.google.firebase.**
-dontwarn androidx.**
-dontwarn kotlinx.coroutines.**
-dontwarn com.google.android.libraries.identity.googleid.**
-dontwarn androidx.credentials.**
-dontwarn org.apache.cordova.**
-dontwarn com.getcapacitor.**
