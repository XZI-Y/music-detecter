; Runs after install directory resolution, before the old app is uninstalled.
!macro customInit
  Push $0
  SetShellVarContext current
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
  ${If} $0 != ""
  ${AndIf} ${FileExists} "$0\resources\models\ast\onnx\model_quantized.onnx"
    CreateDirectory "$APPDATA\听见新喜欢\models\ast\onnx"
    ${IfNot} ${FileExists} "$APPDATA\听见新喜欢\models\ast\onnx\model_quantized.onnx"
      CopyFiles /SILENT "$0\resources\models\ast\onnx\model_quantized.onnx" "$APPDATA\听见新喜欢\models\ast\onnx\model_quantized.onnx"
    ${EndIf}
    ${IfNot} ${FileExists} "$APPDATA\听见新喜欢\models\ast\config.json"
      CopyFiles /SILENT "$0\resources\models\ast\config.json" "$APPDATA\听见新喜欢\models\ast\config.json"
    ${EndIf}
    ${IfNot} ${FileExists} "$APPDATA\听见新喜欢\models\ast\preprocessor_config.json"
      CopyFiles /SILENT "$0\resources\models\ast\preprocessor_config.json" "$APPDATA\听见新喜欢\models\ast\preprocessor_config.json"
    ${EndIf}
  ${EndIf}
  Pop $0
!macroend
