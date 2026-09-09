import MakeUpCore
import SwiftUI

struct RootView: View {
    @Environment(AuthService.self) private var auth

    @State private var localCapture=false

    var body: some View {
        if localCapture {
            VStack {
                HStack {Text("scan.localEntry").font(.headline);Spacer();Button("scan.backToLogin"){localCapture=false}}
                ScanPanel(uid:"device-local",layers:[],brush:nil,onStroke:{_ in},onPhotos:{localCapture=false},showsPhotoTools:false)
            }.padding().frame(maxWidth:.infinity,maxHeight:.infinity)
        } else if auth.user != nil {
            studio
        } else {
            VStack {
                if auth.isReady {NavigationStack {LoginView()}}
                else {ProgressView("status.connecting").frame(maxWidth:.infinity,maxHeight:.infinity)}
                Button("scan.localEntry"){localCapture=true}.buttonStyle(.bordered).padding(.bottom)
            }
        }
    }

    private var studio: some View {
        #if os(macOS)
        StudioView().id(auth.user?.uid).frame(minWidth: 1000, minHeight: 680)
        #else
        StudioView().id(auth.user?.uid)
        #endif
    }
}
